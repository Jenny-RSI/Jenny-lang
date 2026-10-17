#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioError {
    InvalidGain,
    InvalidSampleRate,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizerState {
    pub sample_rate: i32,
    pub processed_samples: usize,
    pub clipped_samples: usize,
}

impl NormalizerState {
    pub fn check_invariant(&self) {
        assert!(self.sample_rate > 0);
        assert!(self.clipped_samples <= self.processed_samples);
    }

    pub fn new(sample_rate: i32) -> Result<NormalizerState, AudioError> {
        if !(sample_rate > 0) {
            return Err(AudioError::InvalidSampleRate);
        }
        let result = NormalizerState {
            sample_rate,
            processed_samples: 0,
            clipped_samples: 0,
        };
        result.check_invariant();
        assert!(result.processed_samples == 0);
        assert!(result.clipped_samples == 0);
        Ok(result)
    }

    pub fn normalize_sample(
        &mut self,
        sample: i64,
        gain_num: i64,
        gain_den: i64,
    ) -> Result<i64, AudioError> {
        self.check_invariant();
        if !(gain_num >= 0 && gain_den > 0) {
            return Err(AudioError::InvalidGain);
        }
        let old_processed = self.processed_samples;
        let scaled = (sample * gain_num) / gain_den;
        let is_clipped = scaled > 32767 || scaled < -32768;
        let clip_inc: usize = if is_clipped { 1 } else { 0 };
        self.processed_samples += 1;
        self.clipped_samples += clip_inc;
        let low_clamp = if scaled < -32768 { -32768 } else { scaled };
        let result = if low_clamp > 32767 { 32767 } else { low_clamp };
        self.check_invariant();
        assert!(self.processed_samples == old_processed + 1);
        assert!(result >= -32768 && result <= 32767);
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_b07_01_pcm_gain_and_clipping() {
        let mut norm = NormalizerState::new(48000).unwrap();
        let s1 = norm.normalize_sample(10000, 2, 1).unwrap();
        assert_eq!(s1, 20000);
        assert_eq!(norm.processed_samples, 1);
        assert_eq!(norm.clipped_samples, 0);

        let s2 = norm.normalize_sample(20000, 2, 1).unwrap();
        assert_eq!(s2, 32767);
        assert_eq!(norm.processed_samples, 2);
        assert_eq!(norm.clipped_samples, 1);
    }

    #[test]
    fn ex_b07_02_reject_invalid_params() {
        assert_eq!(NormalizerState::new(0), Err(AudioError::InvalidSampleRate));
        let mut norm = NormalizerState::new(44100).unwrap();
        assert_eq!(norm.normalize_sample(1000, 2, 0), Err(AudioError::InvalidGain));
    }
}
