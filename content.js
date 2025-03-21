// 存储已发现的图片URL
let discoveredImages = new Set();

// 规范化微信图片URL
function sendImageToBackground(imageUrl) {
  // 使用Set进行去重
  if (!discoveredImages.has(imageUrl)) {
    discoveredImages.add(imageUrl);
    // chrome.runtime.sendMessage({
    //   type: 'NEW_IMAGE',
    //   url: imageUrl
    // });
  }
}

// 检查元素是否在视口中可见
function isElementVisible(element) {
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

// 处理提取页面节点的图片元素。将节点中包含的图片URL发送到函数sendImageToBackground，函数通过new_image消息发送到后台脚本。
function processImage(element) {
  try {
    // 通用属性检查：检查所有元素的所有属性中是否包含HTTP URL且不是JS文件
    // 优化：只检查图片相关的属性,先把明确有文件后缀的 URL 进行检测，把不是图片后缀的 URL 跳过
    //还是不好，太复杂了，效率低下。有什么其他办法吗？

    // if (element.nodeType === 1) { // 确保是元素节点
    //   // 获取元素的所有属性
    //   const attributes = element.attributes;
    //   if (attributes && attributes.length) {
    //     for (let i = 0; i < attributes.length; i++) {
    //       const attrValue = attributes[i].value;
    //       if (attrValue && typeof attrValue === 'string' && attrValue.includes('http')) {
    //         // 提取URL（可能包含在字符串中的多个URL）
    //         const urlRegex = /(https?:\/\/[^\s"'<>()]+)(\.[a-zA-Z0-9_-]+)?$/g;
    //         const matches = attrValue.match(urlRegex);
            
    //         if (matches) {
    //           matches.forEach(url => {
    //             // 确保URL不是JS文件
    //             const ext = url.split('.').pop().toLowerCase();
    //             if (!(['js', 'css', 'html'].includes(ext))) {
    //               sendImageToBackground(url);
    //             }
    //           });
    //         }
    //       }
    //     }
    //   }
    // }
    
    // 检查常规IMG标签
    if (element.tagName === 'IMG' && isElementVisible(element)) {
      const src = element.src || element.dataset.src;
      if (src && src.trim() !== '' && src.startsWith('http')) {
        sendImageToBackground(src);
        console.log('Sending image to background via img src:', src);
      }
      
      // 检查所有可能包含图片URL的属性。
      const possibleAttributes = ['data-src', 'data-original', 'data-url', 'data-full-url', 
        'data-lazy-src', 'data-lazy', 'data-original-src', 'data-srcset',
        'data-source', 'data-high-res-src', 'load-src', 'lazy-src'
      ];
      
      possibleAttributes.forEach(attr => {
        const attrValue = element.getAttribute(attr);
        if (attrValue && attrValue.trim() !== '') {
          const urlRegex = /^https?:\/\//;
          const matches = attrValue.match(urlRegex);
          if (matches) {
            sendImageToBackground(attrValue);
            console.log('Sending image to background via attr:', attrValue);
          }
        }
      });
    }
    
    // 检查CANVAS元素
    // if (element.tagName === 'CANVAS' && element.width > 100 && element.height > 100) {
    //   try {
    //     const dataUrl = element.toDataURL('image/png');
    //     if (dataUrl && dataUrl.startsWith('data:image/')) {
    //       sendImageToBackground(dataUrl);
    //     }
    //   } catch (e) {
    //     // 忽略跨域Canvas错误
    //   }
    // }
    
    // 检查VIDEO元素的poster属性
    if (element.tagName === 'VIDEO' && element.poster) {
      sendImageToBackground(element.poster);
      console.log('Sending image to background via video poster:', element.poster);
    }
    
    // 处理背景图片，看不懂这块。
    // const style = window.getComputedStyle(element);
    // const backgroundImage = style.backgroundImage;
    // if (backgroundImage && backgroundImage !== 'none') {
    //   const matches = backgroundImage.match(/url\(["']?([^"']*)[""]?\)/g);
    //   if (matches) {
    //     matches.forEach(match => {
    //       const url = match.slice(4, -1).replace(/["']/g, '');
    //       if (url && url.trim() !== '' && !url.startsWith('data:image/svg+xml')) {
    //         sendImageToBackground(url);
    //       }
    //     });
    //   }
    // }
    
    // 处理CSS中所有可能的图片属性
    const cssProps = ['backgroundImage'];
    cssProps.forEach(prop => {
      const value = style[prop];
      if (value && value !== 'none' && value.includes('url(')) {
        const matches = value.match(/url\(["']?([^"']*)[""]?\)/g);
        if (matches) {
          matches.forEach(match => {
            const url = match.slice(4, -1).replace(/["']/g, '');
            if (url && url.trim() !== '' && !url.startsWith('data:image/svg+xml')) {
              sendImageToBackground(url);
              console.log('Sending image to background via CSS:', url);
            }
          });
        }
      }
    });
  } catch (error) {
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
  return filename;
}

// 获取文件扩展名
function getFileExtension(url) {
  try {
    const urlObj = new URL(url);
    
    if (url.includes('mmbiz.qpic.cn')) {
      const wxFmt = urlObj.searchParams.get('wx_fmt');
      if (wxFmt) {
        return `.${wxFmt.toLowerCase()}`;
      }
    }
    
    const pathMatch = url.split('?')[0].match(/\.([^./?#]+)$/i);
    if (pathMatch) {
      return `.${pathMatch[1].toLowerCase()}`;
    }
    
    return '.png';
  } catch (e) {
    return '.png';
  }
}

// 下载图片
async function downloadImage(url) {
  try {
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
      } else {
      }
    };
    
    xhr.onerror = function() {
    };
    
    xhr.send();
  } catch (error) {
  }
}

// 批量下载多个图片
async function downloadImages(urls) {
  
  // 创建下载文件夹
  try {
    // 每个URL单独下载，避免浏览器阻止多个下载
    for (const url of urls) {
      await downloadImage(url);
      // 暂停一小段时间，避免浏览器阻止批量下载
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  } catch (error) {
  }
}

// 扫描页面中的所有图片
function scanImages() {
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

// 监听来自background 和sidepanel的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GET_IMAGES') {
    sendResponse(Array.from(discoveredImages));
    // console.log('Sent discoveredImages from content script answer getimages:', Array.from(discoveredImages));
  } else if (request.type === 'PING') {
    // 简单的ping响应，用于检测内容脚本是否已注入
    sendResponse({ success: true });
    return true; // 异步响应
  } else if (request.type === 'PERFORM_DOWNLOAD') {
    downloadImages(request.urls);
    // 返回成功状态，告知background.js下载已处理
    sendResponse({ success: true });
    return true; // 异步响应
  } else if (request.type === 'SCAN_IMAGES') {
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