function navigateTo(url, data = {}) {
  const iframe = document.getElementById('app-frame');
  iframe.onload = () => {
    iframe.contentWindow.postMessage(data);
  };
  iframe.src = url;
}
