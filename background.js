// 存储发现的图片URL
let imageUrls = new Set();

// 监听来自content script的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'NEW_IMAGE') {
    imageUrls.add(request.url);
    sendResponse({ success: true });
    return false; // 同步响应
  } else if (request.type === 'GET_ALL_IMAGES') {
    sendResponse(Array.from(imageUrls));
    return false; // 同步响应
  } else if (request.type === 'DOWNLOAD_IMAGES') {
    console.log('Received download request for URLs:', request.urls);
    
    // 记录下载方式，避免重复下载
    let downloadStarted = false;
    
    // 将下载请求发送到内容脚本
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs && tabs.length > 0) {
        try {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'PERFORM_DOWNLOAD',
            urls: request.urls
          }, response => {
            if (chrome.runtime.lastError) {
              console.log('发送消息错误 (正常，可忽略):', chrome.runtime.lastError.message);
              // 只有当内容脚本下载失败时才使用Chrome API下载
              if (!downloadStarted) {
                downloadStarted = true;
                console.log('使用Chrome API下载图片');
                downloadImagesDirectly(request.urls);
              }
            } else if (response && response.success) {
              // 内容脚本成功处理了下载
              downloadStarted = true;
              console.log('内容脚本成功处理了下载请求');
            } else if (!downloadStarted) {
              // 内容脚本没有明确成功，但也没有错误，使用Chrome API作为备选
              downloadStarted = true;
              console.log('内容脚本未明确响应，使用Chrome API下载');
              downloadImagesDirectly(request.urls);
            }
          });
        } catch (error) {
          console.log('发送消息异常，尝试直接下载:', error);
          if (!downloadStarted) {
            downloadStarted = true;
            downloadImagesDirectly(request.urls);
          }
        }
      } else {
        console.error('No active tab found for download');
        if (!downloadStarted) {
          downloadStarted = true;
          downloadImagesDirectly(request.urls);
        }
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

// 直接使用Chrome API下载图片
function downloadImagesDirectly(urls) {
  urls.forEach(url => {
    const filename = generateRandomFileName(getFileExtension(url));
    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: true
    });
  });
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