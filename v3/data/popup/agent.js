{
  const args = new URLSearchParams(location.search);

  /* agent (detached) mode */
  if (args.get('mode') === 'detached') {
    self.port = chrome.runtime.connect({
      name: 'popup'
    });
    self.port.onDisconnect.addListener(() => {
      const e = chrome.runtime.lastError;
      if (e) {
        console.warn(e);
      }
      delete self.port;
    });
  }
}
