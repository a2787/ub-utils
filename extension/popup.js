(() => {
  'use strict';
  const version = document.getElementById('popup-version');
  const manifest = chrome.runtime.getManifest();
  if (version) version.textContent = '版本 v' + manifest.version + ' · 同一构建可用于电脑和平板';
  const button = document.getElementById('open-options');
  if (button) button.onclick = () => chrome.runtime.openOptionsPage();
})();
