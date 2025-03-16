// 存储已发现的图片URL
let discoveredImages = new Set();

// 规范化微信图片URL
function normalizeWechatImageUrl(url) {
  try {
    if (!url) return '';
    
    // 处理微信图片URL
    if (url.includes('mmbiz.qpic.cn') || url.includes('mmsns.qpic.cn')) {
      // 提取基础URL（移除所有参数）
      let baseUrl = url.split('?')[0];
      
      // 清理URL中的数字参数（通常是尺寸相关）
      baseUrl = baseUrl.replace(/\d+$/, '');
      
      return baseUrl;
    }
    return url;
  } catch (error) {
    console.error('规范化URL出错:', error);
    return url;
  }
}

// 发送图片URL到后台脚本
function sendImageToBackground(imageUrl) {
  // 规范化URL
  const normalizedUrl = normalizeWechatImageUrl(imageUrl);
  
  // 使用规范化后的URL进行去重
  if (!discoveredImages.has(normalizedUrl)) {
    console.log('发现新图片:', imageUrl, '规范化后:', normalizedUrl);
    discoveredImages.add(normalizedUrl);
    chrome.runtime.sendMessage({
      type: 'NEW_IMAGE',
      url: imageUrl,
      normalizedUrl: normalizedUrl
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
  try {
    // 检查常规IMG标签
    if (element.tagName === 'IMG' && isElementVisible(element)) {
      const src = element.src || element.dataset.src;
      if (src && src.trim() !== '' && !src.startsWith('data:image/svg+xml')) {
        // 只处理微信图片
        if (src.includes('mmbiz.qpic.cn') || src.includes('mmsns.qpic.cn')) {
          sendImageToBackground(src);
        }
      }
      
      // 检查所有可能包含图片URL的属性
      const possibleAttributes = ['data-src', 'data-original', 'data-url', 'data-full-url', 
        'data-lazy-src', 'data-lazy', 'data-original-src', 'data-srcset',
        'data-source', 'data-high-res-src', 'load-src', 'lazy-src'
      ];
      
      possibleAttributes.forEach(attr => {
        const attrValue = element.getAttribute(attr);
        if (attrValue && attrValue.trim() !== '' && 
            !attrValue.startsWith('data:image/svg+xml') && 
            (attrValue.includes('mmbiz.qpic.cn') || attrValue.includes('mmsns.qpic.cn'))) {
          sendImageToBackground(attrValue);
        }
      });
    }
    
    // 检查CANVAS元素
    if (element.tagName === 'CANVAS' && element.width > 100 && element.height > 100) {
      try {
        const dataUrl = element.toDataURL('image/png');
        if (dataUrl && dataUrl.startsWith('data:image/')) {
          sendImageToBackground(dataUrl);
        }
      } catch (e) {
        // 忽略跨域Canvas错误
        console.log('Canvas处理错误 (可忽略, 跨域限制):', e.message);
      }
    }
    
    // 检查VIDEO元素的poster属性
    if (element.tagName === 'VIDEO' && element.poster) {
      sendImageToBackground(element.poster);
    }
    
    // 处理背景图片
    const style = window.getComputedStyle(element);
    const backgroundImage = style.backgroundImage;
    if (backgroundImage && backgroundImage !== 'none') {
      const matches = backgroundImage.match(/url\(["']?([^"']*)[""]?\)/g);
      if (matches) {
        matches.forEach(match => {
          const url = match.slice(4, -1).replace(/["']/g, '');
          if (url && url.trim() !== '' && !url.startsWith('data:image/svg+xml')) {
            sendImageToBackground(url);
          }
        });
      }
    }
    
    // 处理CSS中所有可能的图片属性
    const cssProps = ['backgroundImage', 'content', 'listStyleImage'];
    cssProps.forEach(prop => {
      const value = style[prop];
      if (value && value !== 'none' && value.includes('url(')) {
        const matches = value.match(/url\(["']?([^"']*)[""]?\)/g);
        if (matches) {
          matches.forEach(match => {
            const url = match.slice(4, -1).replace(/["']/g, '');
            if (url && url.trim() !== '' && !url.startsWith('data:image/svg+xml')) {
              sendImageToBackground(url);
            }
          });
        }
      }
    });
  } catch (error) {
    console.log('图片处理过程中发生错误 (可忽略):', error.message);
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
  console.log('扫描页面中的所有图片，URL:', window.location.href);
  document.querySelectorAll('*').forEach(processImage);
}

// 添加延迟扫描函数，确保捕获延迟加载的图片
function scanWithDelay() {
  // 首次扫描
  scanImages();
  
  // 设置多次延迟扫描以捕获动态加载的内容
  const delays = [1000, 3000, 5000];
  delays.forEach(delay => {
    setTimeout(() => {
      console.log(`延迟 ${delay}ms 扫描页面`);
      scanImages();
    }, delay);
  });
  
  // 每10秒进行一次重新扫描（最多5分钟）
  let scanCount = 0;
  const intervalId = setInterval(() => {
    scanCount++;
    if (scanCount > 30) { // 5分钟后停止
      clearInterval(intervalId);
      return;
    }
    console.log('定期重新扫描页面');
    scanImages();
  }, 10000);
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

// 执行延迟扫描
scanWithDelay();

// 监听来自popup和background的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GET_IMAGES') {
    sendResponse(Array.from(discoveredImages));
  } else if (request.type === 'PING') {
    // 简单的ping响应，用于检测内容脚本是否已注入
    console.log('收到PING消息，响应以确认内容脚本已注入');
    sendResponse({ success: true });
    return true; // 异步响应
  } else if (request.type === 'PERFORM_DOWNLOAD') {
    console.log('Content script received PERFORM_DOWNLOAD message');
    downloadImages(request.urls);
    // 返回成功状态，告知background.js下载已处理
    sendResponse({ success: true });
    return true; // 异步响应
  } else if (request.type === 'SCAN_IMAGES') {
    console.log('重新扫描页面图片...');
    // 清空已发现的图片集合
    discoveredImages.clear();
    // 重新扫描页面
    scanImages();
    // 设置延迟扫描，捕获可能的延迟加载图片
    setTimeout(() => {
      scanImages();
      sendResponse({ success: true, count: discoveredImages.size });
    }, 1000);
    return true; // 异步响应
  }
});