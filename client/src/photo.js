// Photos for the AI chats: shrunk in the browser so uploads stay small (the server takes up to 1.5 MB)
const MAX_SIDE = 1024;

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a picture we can read.')); };
    img.src = url;
  });
}

// Draw a picture or video frame onto a canvas, long side at most MAX_SIDE, and return it as JPEG:
// { mimeType, data } for the server (plain base64) and previewUrl for the chat bubble
export function canvasPhoto(source, width, height) {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  const previewUrl = canvas.toDataURL('image/jpeg', 0.8);
  return { mimeType: 'image/jpeg', data: previewUrl.split(',')[1], previewUrl };
}

export async function shrinkImage(blob) {
  const img = await loadImage(blob);
  return canvasPhoto(img, img.naturalWidth, img.naturalHeight);
}
