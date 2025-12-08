# Audio Alert Files

This directory should contain the following audio files for the trading observatory:

## Required Files

| File | Purpose | Recommended Duration |
|------|---------|---------------------|
| `critical.mp3` | Kill switch, live port warning, critical alerts | 2-3 seconds, loud |
| `warning.mp3` | Risk threshold warnings | 1-2 seconds, moderate |
| `success.mp3` | Trade executed, position closed | 0.5-1 second, pleasant |
| `chime.mp3` | General notification | 0.5 second, subtle |

## Recommendations

1. **Critical**: Use an unmistakable alert sound (alarm, siren)
2. **Warning**: Use a noticeable but not alarming sound
3. **Success**: Use a positive confirmation sound
4. **Chime**: Use a subtle notification sound

## Free Sound Sources

- [Freesound.org](https://freesound.org) - Search "alert", "notification"
- [Mixkit](https://mixkit.co/free-sound-effects/) - Free sound effects

## Code Handles Missing Files

The components use try/catch blocks for audio playback, so missing files
won't break functionality - they'll just log a warning to console.
