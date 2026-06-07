const args = new URLSearchParams(location.search);
if (args.get('mode') === 'popup') {
  document.body.classList.add('popup');
}

self.command = request => {
  if (request.cmd === 'navigate') {
    self.toast.clean();

    const iframe = document.getElementById('app-frame');
    iframe.onload = () => {
      iframe.contentWindow.postMessage(request.data, '*');
    };
    iframe.src = request.href;
  }
  else if (request.cmd === 'notify') {
    self.toast.notify(request.message, request.type);
  }
};
