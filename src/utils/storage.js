export async function getStoredKey(platform) {
  return new Promise((resolve) => {
    chrome.storage.local.get([`api_key_${platform}`], (result) => {
      resolve(result[`api_key_${platform}`] || null);
    });
  });
}

export async function setStoredKey(platform, key) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [`api_key_${platform}`]: key }, () => {
      resolve();
    });
  });
}
