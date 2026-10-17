use std::sync::atomic::{AtomicI64, Ordering};

static ACTIVE_BOXES: AtomicI64 = AtomicI64::new(0);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameError {
    InvalidGain,
    ClippingDetected,
    ZeroSampleRate,
}

#[derive(Debug)]
pub struct PcmFrame {
    pub seq_id: i64,
    pub sample_rate: i64,
    pub s0: i64,
    pub s1: i64,
    pub s2: i64,
    pub s3: i64,
    pub gain_applied: i64,
}

impl Drop for PcmFrame {
    fn drop(&mut self) {
        ACTIVE_BOXES.fetch_sub(1, Ordering::SeqCst);
    }
}

impl PcmFrame {
    pub fn check_invariant(&self) {
        assert!(self.sample_rate > 0);
        assert!(self.gain_applied >= 1 && self.gain_applied <= 16);
    }

    pub fn peak_energy(&self) -> i64 {
        self.check_invariant();
        let a0 = if self.s0 < 0 { -self.s0 } else { self.s0 };
        let a1 = if self.s1 < 0 { -self.s1 } else { self.s1 };
        let a2 = if self.s2 < 0 { -self.s2 } else { self.s2 };
        let a3 = if self.s3 < 0 { -self.s3 } else { self.s3 };
        let m01 = if a0 > a1 { a0 } else { a1 };
        let m23 = if a2 > a3 { a2 } else { a3 };
        let result = if m01 > m23 { m01 } else { m23 };
        assert!(result >= 0);
        result
    }

    pub fn apply_gain_in_place(&mut self, gain: i64) -> Result<i64, FrameError> {
        self.check_invariant();
        let old_gain = self.gain_applied;
        if gain < 1 || gain > 16 {
            return Err(FrameError::InvalidGain);
        }
        self.s0 *= gain;
        self.s1 *= gain;
        self.s2 *= gain;
        self.s3 *= gain;
        self.gain_applied = gain;
        let peak = self.peak_energy();
        if peak > 32767 {
            return Err(FrameError::ClippingDetected);
        }
        self.check_invariant();
        assert!(self.gain_applied == gain || self.gain_applied == old_gain);
        Ok(peak)
    }
}

pub fn alloc_pcm_frame(
    seq_id: i64,
    sample_rate: i64,
    s0: i64,
    s1: i64,
    s2: i64,
    s3: i64,
) -> Result<Box<PcmFrame>, FrameError> {
    let old_boxes = ACTIVE_BOXES.load(Ordering::SeqCst);
    if sample_rate <= 0 {
        return Err(FrameError::ZeroSampleRate);
    }
    ACTIVE_BOXES.fetch_add(1, Ordering::SeqCst);
    let b = Box::new(PcmFrame {
        seq_id,
        sample_rate,
        s0,
        s1,
        s2,
        s3,
        gain_applied: 1,
    });
    b.check_invariant();
    assert!(ACTIVE_BOXES.load(Ordering::SeqCst) == old_boxes + 1);
    Ok(b)
}

pub fn consume_and_archive(frame: Box<PcmFrame>) -> i64 {
    frame.check_invariant();
    let old_boxes = ACTIVE_BOXES.load(Ordering::SeqCst);
    let sum = frame.s0 + frame.s1 + frame.s2 + frame.s3;
    let res = frame.seq_id * 100000 + sum;
    drop(frame);
    assert!(ACTIVE_BOXES.load(Ordering::SeqCst) == old_boxes - 1);
    res
}

pub fn run_frame_pipeline(
    seq_id: i64,
    sample_rate: i64,
    s0: i64,
    s1: i64,
    s2: i64,
    s3: i64,
    gain: i64,
) -> Result<i64, FrameError> {
    let old_boxes = ACTIVE_BOXES.load(Ordering::SeqCst);
    let res = (|| {
        let mut frame = alloc_pcm_frame(seq_id, sample_rate, s0, s1, s2, s3)?;
        let _peak = frame.apply_gain_in_place(gain)?;
        Ok(consume_and_archive(frame))
    })();
    assert!(ACTIVE_BOXES.load(Ordering::SeqCst) == old_boxes);
    res
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_b13_01_unique_frame_borrow_mut_and_own() {
        let base_boxes = ACTIVE_BOXES.load(Ordering::SeqCst);
        let mut f = alloc_pcm_frame(7, 48000, 100, -200, 300, 50).unwrap();
        assert_eq!(ACTIVE_BOXES.load(Ordering::SeqCst), base_boxes + 1);
        assert_eq!(f.peak_energy(), 300);

        let new_peak = f.apply_gain_in_place(4).unwrap();
        assert_eq!(new_peak, 1200);

        let digest = consume_and_archive(f);
        assert_eq!(digest, 701000);
        assert_eq!(ACTIVE_BOXES.load(Ordering::SeqCst), base_boxes);
    }

    #[test]
    fn ex_b13_02_zero_leak_across_error_exits() {
        let base_boxes = ACTIVE_BOXES.load(Ordering::SeqCst);
        assert_eq!(run_frame_pipeline(3, 44100, 10, 20, 30, 40, 2).unwrap(), 300200);
        assert_eq!(ACTIVE_BOXES.load(Ordering::SeqCst), base_boxes);

        assert_eq!(
            run_frame_pipeline(4, 44100, 10000, 20, 30, 40, 8),
            Err(FrameError::ClippingDetected)
        );
        assert_eq!(ACTIVE_BOXES.load(Ordering::SeqCst), base_boxes);

        assert_eq!(
            run_frame_pipeline(5, 0, 10, 20, 30, 40, 2),
            Err(FrameError::ZeroSampleRate)
        );
        assert_eq!(ACTIVE_BOXES.load(Ordering::SeqCst), base_boxes);
    }
}
