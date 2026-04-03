const video = document.getElementById('videoElement');
const canvas = document.getElementById('canvasElement');
const ctx = canvas.getContext('2d', { alpha: false });

async function startCapture() {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: {
        displaySurface: 'monitor',
        width: { ideal: 1920, max: 1920 },
        height: { ideal: 1080, max: 1080 },
        frameRate: { ideal: 5, max: 10 }
      }
    });

    video.srcObject = stream;
    
    video.onloadedmetadata = () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      video.play();
      
      // Capture a frame every 3000ms
      setInterval(() => {
        captureFrame();
      }, 3000);
      
      // Initial capture
      captureFrame();
    };
  } catch (err) {
    console.error('Error starting screen capture:', err);
  }
}

function captureFrame() {
  if (video.videoWidth > 0 && video.videoHeight > 0) {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    if (window.assistant && window.assistant.sendScreenshot) {
      window.assistant.sendScreenshot(dataUrl);
    }
  }
}

startCapture();
