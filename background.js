// 存储发现的图片URL
let imageUrls = new Set();

// 监听来自content script的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request);
  if (request.type === 'NEW_IMAGE') {
    imageUrls.add(request.url);
    sendResponse({ success: true });
    return false; // 同步响应
  } else if (request.type === 'GET_ALL_IMAGES') {
    sendResponse(Array.from(imageUrls));
    return false; // 同步响应
  } else if (request.type === 'DOWNLOAD_IMAGES') {
    console.log('Received download request for URLs:', request.urls);
    
    // 将下载请求发送到内容脚本
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs && tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'PERFORM_DOWNLOAD',
          urls: request.urls
        });
      } else {
        console.error('No active tab found for download');
      }
    });
    sendResponse({ success: true });
    return false; // 同步响应
  } else if (request.type === 'CLEAR_IMAGES') {
    imageUrls.clear();
    sendResponse({ success: true });
    return false; // 同步响应
  } else if (request.type === 'REGISTER_SIDE_PANEL') {
    // 注册侧边栏
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    sendResponse({ success: true });
    return false; // 同步响应
  }
  return false; // 默认同步响应
});

// 生成随机文件名（为了兼容性保留，但主要在content.js中使用）
function generateRandomFileName(extension) {
  const adjectives = ['happy', 'sunny', 'bright', 'shiny', 'lovely', 'cool', 'sweet', 'warm', 'fresh', 'nice'];
  const nouns = ['photo', 'image', 'picture', 'moment', 'memory', 'shot', 'snap', 'view', 'scene', 'capture'];
  
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const randomNum = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
  const timestamp = Date.now();
  
  const filename = `${adjective}_${noun}_${randomNum}_${timestamp}${extension}`;
  console.log('Generated filename:', filename);
  return filename;
}

// 获取文件扩展名（为了兼容性保留，但主要在content.js中使用）
function getFileExtension(url) {
  try {
    console.log('Getting extension for URL:', url);
    const urlObj = new URL(url);
    
    if (url.includes('mmbiz.qpic.cn')) {
      const wxFmt = urlObj.searchParams.get('wx_fmt');
      if (wxFmt) {
        console.log('Found wx_fmt extension:', wxFmt);
        return `.${wxFmt.toLowerCase()}`;
      }
    }
    
    const pathMatch = url.split('?')[0].match(/\.([^./?#]+)$/i);
    if (pathMatch) {
      console.log('Found path extension:', pathMatch[1]);
      return `.${pathMatch[1].toLowerCase()}`;
    }
    
    console.log('Using default extension: .png');
    return '.png';
  } catch (e) {
    console.error('获取扩展名错误:', e);
    return '.png';
  }
}

// 初始化侧边栏
chrome.runtime.onInstalled.addListener(() => {
  // 设置侧边栏在点击扩展图标时打开
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// 监听网络请求以捕获图片
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.type === 'image' || details.url.match(/\.(jpg|jpeg|png|gif|webp)($|\?)/i)) {
      imageUrls.add(details.url);
    }
  },
  { urls: ["<all_urls>"] }
);