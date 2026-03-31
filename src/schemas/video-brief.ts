export interface FrameControl {
  frameIndex: number;
  shotType: 'wide' | 'medium' | 'close' | 'extreme_close' | 'over_shoulder' | 'pov';
  visualDescription: string;
  textOverlay?: string;
  voiceover?: string;
  durationSec: number;
}

export interface VideoBrief {
  id: string;
  prototypeBriefId: string;
  narrative: string;
  tone: string;
  duration: number;
  audience: string;
  frames: FrameControl[];
}
