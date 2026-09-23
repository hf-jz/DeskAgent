import MochiSvg from './MochiSvg'
import BoboSvg from './BoboSvg'
import PetdexSvg from './PetdexSvg'

export type PetPose = 'idle' | 'crawl' | 'lie' | 'sleep'
export type PetSpecies = 'mochi' | 'bobo' | 'nukey' | 'boba' | 'boxcat' | 'punchy' | 'scoop'
export type PetMood = 'idle' | 'working' | 'error' | 'listening' | 'thinking' | 'speaking' | 'happy' | 'confused'

interface PetCharacterProps {
  species: PetSpecies
  pose: PetPose
  mood: PetMood
  facing?: 'left' | 'right'
  mouthOpen?: number  // 0 = closed, 1 = neutral, 2 = wide open
  /** cursor proximity — pet turns its head toward the mouse */
  mouse?: { near: boolean; dx: number; dy: number }
}

// Pose/mood animations + facing flip. Previously these classes had NO CSS
// (the pet rendered static); this restores the full animation system and
// adds head-tracking via the .pet-stage inline transform (outer layer).
const PET_CSS = `
  .pet-stage { position: relative; width: 100%; height: 100%; transform-origin: 50% 90%; transition: transform 0.35s ease-out; }
  .pet-face, .pet-flip, .pet-mood { width: 100%; height: 100%; transform-origin: 50% 100%; }
  .pet-stage svg { width: 100%; height: 100%; display: block; }
  .pet-face.face-left { transform: scaleX(-1); }
  /* poses */
  .pet-stage.pose-idle .pet-flip { animation: petIdle 3.6s ease-in-out infinite; }
  .pet-stage.pose-crawl .pet-flip { animation: petWalkBounce 0.5s ease-in-out infinite; }
  .pet-stage.pose-lie .pet-flip { animation: petLie 4.5s ease-in-out infinite; }
  .pet-stage.pose-sleep .pet-flip { animation: petLie 5s ease-in-out infinite; }
  .pet-stage.pose-sleep .pet-mood { filter: brightness(0.7) saturate(0.85); }
  /* moods (override on top of pose) */
  .pet-stage.mood-working .pet-mood, .pet-stage.mood-thinking .pet-mood { animation: petPulse 0.8s ease-in-out infinite; }
  .pet-stage.mood-speaking .pet-mood { animation: petIdle 2s ease-in-out infinite; }
  .pet-stage.mood-happy .pet-mood { animation: petJump 0.6s ease-out 2; }
  .pet-stage.mood-confused .pet-mood, .pet-stage.mood-error .pet-mood { animation: petShake 0.4s ease-in-out infinite; }
  /* sleep zzz */
  .pet-stage .pet-zzz { position: absolute; top: 2%; right: 8%; display: flex; flex-direction: column; align-items: center; opacity: 0; pointer-events: none; }
  .pet-stage.pose-sleep .pet-zzz { opacity: 1; }
  .pet-zzz span { font-size: 11px; font-weight: 700; color: var(--ink-muted, #9CA3AF); animation: petZzz 2.4s ease-in-out infinite; }
  .pet-zzz span:nth-child(2) { animation-delay: 0.6s; font-size: 9px; }
  .pet-zzz span:nth-child(3) { animation-delay: 1.2s; font-size: 7px; }
  @keyframes petIdle { 0%,100% { transform: scale(1) translateY(0); } 50% { transform: scale(1.035) translateY(-2%); } }
  @keyframes petWalkBounce { 0%,100% { transform: translateY(0) rotate(3deg); } 50% { transform: translateY(-6%) rotate(-3deg); } }
  @keyframes petLie { 0%,100% { transform: scaleY(0.86); } 50% { transform: scaleY(0.9); } }
  @keyframes petPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.07); } }
  @keyframes petJump { 0% { transform: translateY(0); } 35% { transform: translateY(-18%); } 70% { transform: translateY(0); } 100% { transform: translateY(0); } }
  @keyframes petShake { 0%,100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } }
  @keyframes petZzz { 0% { transform: translateY(0); opacity: 0; } 25% { opacity: 1; } 100% { transform: translateY(-14px); opacity: 0; } }
`

export default function PetCharacter({ species, pose, mood, facing = 'right', mouthOpen = 1, mouse }: PetCharacterProps): React.JSX.Element {
  const near = mouse?.near === true
  const headTransform = near
    ? `rotate(${Math.max(-8, Math.min(8, (mouse.dx / 22))) }deg) translateX(${Math.max(-5, Math.min(5, mouse.dx / 60))}px)`
    : undefined
  return (
    <div className={`pet-stage pose-${pose} mood-${mood} species-${species}`} style={{ transform: headTransform }}>
      <style>{PET_CSS}</style>
      <div className={`pet-face ${facing === 'left' ? 'face-left' : ''}`}>
        <div className="pet-flip">
          <div className="pet-mood">
            {species === 'mochi' ? <MochiSvg mouthOpen={mouthOpen} /> : species === 'bobo' ? <BoboSvg mouthOpen={mouthOpen} /> : <PetdexSvg which={species} />}
          </div>
        </div>
      </div>
      <div className="pet-zzz" aria-hidden="true">
        <span>Z</span><span>z</span><span>z</span>
      </div>
    </div>
  )
}
