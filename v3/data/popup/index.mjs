self.args = new URLSearchParams(location.search);
if (self.args.get('mode') === 'popup') {
  document.body.classList.add('popup');
}

const actions = {
  codes: new Set() // add these otps once the search internace is loaded
};
self.command = request => {
  if (request.cmd === 'navigate') {
    self.toast.clean();

    const iframe = document.getElementById('app-frame');
    iframe.onload = () => {
      if (request.href.startsWith('search/index.html')) {
        request.data.codes = actions.codes;
      }
      iframe.contentWindow.postMessage(request.data, '*');
    };
    iframe.src = request.href;
  }
  else if (request.cmd === 'notify') {
    self.toast.notify(request.message, request.type);
  }
};

// to receive commands from worker
chrome.runtime.onMessage.addListener(request => {
  if (request.method === 'add-otp') {
    actions.codes.add(...request.codes);
    self.toast.notify('Unlock to add new OTPs', 'info');
  }
});
