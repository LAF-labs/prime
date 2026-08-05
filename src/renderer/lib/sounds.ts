/**
 * Play a short notification chime using the Web Audio API.
 * Two-tone ding: ~1 second total, no external audio files needed.
 */
export const playNotificationSound = (): void => {
  try {
    const ctx = new AudioContext()
    const now = ctx.currentTime

    const playTone = (freq: number, start: number, duration: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.3, start)
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(start)
      osc.stop(start + duration)
    }

    playTone(880, now, 0.15)
    playTone(1320, now + 0.15, 0.3)

    setTimeout(() => ctx.close().catch(() => {}), 1000)
  } catch {
    // Audio not available — silently ignore
  }
}
