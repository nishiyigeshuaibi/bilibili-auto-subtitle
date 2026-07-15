const toggle = document.getElementById('toggle');
const status = document.getElementById('status');

// 读取存储的状态，默认开启
chrome.storage.sync.get({ enabled: true }, (result) => {
  toggle.checked = result.enabled;
  updateStatus(result.enabled);
});

// 切换开关
toggle.addEventListener('change', () => {
  const isOn = toggle.checked;
  chrome.storage.sync.set({ enabled: isOn });
  updateStatus(isOn);
});

function updateStatus(isOn) {
  status.textContent = isOn ? '已开启' : '已关闭';
  status.style.color = isOn ? '#00a1d6' : '#999';
}
