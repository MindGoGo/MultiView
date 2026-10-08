// 用 canvas 產生會動的影片（含一個小聲的音調），不需要影片檔。
// fakeVideo(video, label, color)：把 video 接上產生的畫面並開始播放。
window.fakeVideo = function (video, label, color) {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 360
  const ctx = canvas.getContext('2d')
  let n = 0
  setInterval(() => {
    ctx.fillStyle = color
    ctx.fillRect(0, 0, 640, 360)
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 56px sans-serif'
    ctx.fillText(label, 30, 140)
    ctx.font = '40px monospace'
    ctx.fillText(String(n++), 30, 240)
  }, 100)
  const stream = canvas.captureStream(10)
  try {
    const audio = new AudioContext()
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    gain.gain.value = 0.05
    const dest = audio.createMediaStreamDestination()
    osc.connect(gain).connect(dest)
    osc.start()
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t))
  } catch {
    // 沒有聲音也可以測畫面
  }
  video.srcObject = stream
  video.autoplay = true
  video.play().catch(() => undefined)
}
