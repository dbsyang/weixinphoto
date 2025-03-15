// 存储已发现的图片URL
let discoveredImages = new Set();

// 发送图片URL到后台脚本
function sendImageToBackground(imageUrl) {
  if (!discoveredImages.has(imageUrl)) {
    discoveredImages.add(imageUrl);
    chrome.runtime.sendMessage({
      type: 'NEW_IMAGE',
      url: imageUrl
    });
  }
}

// 检查元素是否在视口中可见
function isElementVisible(element) {
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

// 处理图片元素
function processImage(element) {
  if (element.tagName === 'IMG' && isElementVisible(element)) {
    const src = element.src || element.dataset.src;
    if (src) {
      sendImageToBackground(src);
    }
  }
  // 处理背景图片
  const style = window.getComputedStyle(element);
  const backgroundImage = style.backgroundImage;
  if (backgroundImage && backgroundImage !== 'none') {
    const matches = backgroundImage.match(/url\(["']?([^"']*)[""]?\)/g);
    if (matches) {
      matches.forEach(match => {
        const url = match.slice(4, -1).replace(/["']/g, '');
        if (url) {
          sendImageToBackground(url);
        }
      });
    }
  }
}

// 生成随机文件名
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

// 获取文件扩展名
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

// 下载图片
async function downloadImage(url) {
  try {
    console.log('Downloading image:', url);
    const extension = getFileExtension(url);
    const filename = generateRandomFileName(extension);
    
    // 创建一个隐藏的a元素
    const link = document.createElement('a');
    link.style.display = 'none';
    
    // 使用XMLHttpRequest获取图片内容
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'blob';
    
    xhr.onload = function() {
      if (xhr.status === 200) {
        // 创建blob URL
        const blob = xhr.response;
        const blobUrl = URL.createObjectURL(blob);
        
        // 设置下载属性
        link.href = blobUrl;
        link.download = filename;
        document.body.appendChild(link);
        
        // 触发点击
        link.click();
        
        // 清理
        document.body.removeChild(link);
        setTimeout(function() {
          URL.revokeObjectURL(blobUrl);
        }, 100);
        
        console.log('Download completed for:', filename);
      } else {
        console.error('Failed to download image:', xhr.status);
      }
    };
    
    xhr.onerror = function() {
      console.error('XHR error when downloading image');
    };
    
    xhr.send();
  } catch (error) {
    console.error('Error downloading image:', error);
  }
}

// 批量下载多个图片
async function downloadImages(urls) {
  console.log('Content script received download request for URLs:', urls);
  
  // 创建下载文件夹
  try {
    // 每个URL单独下载，避免浏览器阻止多个下载
    for (const url of urls) {
      await downloadImage(url);
      // 暂停一小段时间，避免浏览器阻止批量下载
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  } catch (error) {
    console.error('批量下载错误:', error);
  }
}

// 扫描页面中的所有图片
function scanImages() {
  document.querySelectorAll('*').forEach(processImage);
}

// 监听DOM变化
const observer = new MutationObserver((mutations) => {
  mutations.forEach(mutation => {
    // 处理新增的节点
    mutation.addedNodes.forEach(node => {
      if (node.nodeType === 1) { // 元素节点
        processImage(node);
        // 处理子元素
        node.querySelectorAll('*').forEach(processImage);
      }
    });
    // 处理属性变化
    if (mutation.type === 'attributes') {
      processImage(mutation.target);
    }
  });
});

// 开始监听
observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['src', 'style']
});

// 初始扫描
scanImages();

// 监听来自popup和background的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GET_IMAGES') {
    sendResponse(Array.from(discoveredImages));
  } else if (request.type === 'PERFORM_DOWNLOAD') {
    console.log('Content script received PERFORM_DOWNLOAD message');
    downloadImages(request.urls);
  }
});