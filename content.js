(function () {
  'use strict';

  // ========== 配置 ==========
  const CONFIG = {
    // 页面加载后首次尝试的延迟 (ms)
    INITIAL_DELAY: 2000,
    // 重试间隔 (ms)
    RETRY_INTERVAL: 500,
    // 最大重试次数
    MAX_RETRIES: 30,
    // 点击字幕按钮后等待菜单展开的延迟 (ms)
    MENU_DELAY: 200,
    // SPA 导航后重新触发的延迟 (ms)
    NAVIGATION_DELAY: 2000,
  };

  // ========== 选择器 ==========
  const SELECTORS = {
    // 底部控制栏的字幕按钮
    subtitleBtn: '.bpx-player-ctrl-subtitle',
    // 字幕语言选项
    languageItem: '.bpx-player-ctrl-subtitle-language-item[data-lan]',
    // AI 中文字幕
    aiChinese: '.bpx-player-ctrl-subtitle-language-item[data-lan="ai-zh"]',
  };

  // ========== 状态 ==========
  let enabled = false;       // 当前页面字幕是否已开启
  let retryTimer = null;     // 重试定时器
  let retryCount = 0;        // 当前重试次数
  let featureEnabled = true; // 功能总开关（来自 storage）

  // ========== 工具函数 ==========
  const log = (...args) => console.log('[B站自动字幕]', ...args);
  const warn = (...args) => console.warn('[B站自动字幕]', ...args);

  // ========== 核心逻辑 ==========

  /**
   * 执行开启字幕的操作
   *
   * 逻辑说明：
   * 1. B站字幕按钮有两种行为：
   *    - 从未选过语言：点击 → 弹出语言选择菜单
   *    - 已选过语言：  点击 → 直接 toggle 字幕开关
   * 2. 如果字幕已开启（按钮有激活态），则跳过，避免 toggle 反而关掉字幕
   * 3. 如果字幕未开启，点击按钮后尝试从菜单中选语言来开启
   */
  function enableSubtitle() {
    if (enabled) return true;

    const btn = document.querySelector(SELECTORS.subtitleBtn);
    if (!btn) {
      return false; // 播放器还没加载好，需要重试
    }

    // 检查按钮是否处于激活态 → 字幕已经开着，无需操作
    if (
      btn.classList.contains('bpx-player-state-active') ||
      btn.getAttribute('aria-pressed') === 'true'
    ) {
      enabled = true;
      log('字幕已处于开启状态，无需操作 ✓');
      return true;
    }

    // 字幕未开启 → 点击按钮
    // 如果用户之前选过语言，这次 click 会直接 toggle 开启字幕
    // 如果没选过，会弹出语言选择菜单
    btn.click();
    log('已点击字幕按钮');

    // 等待菜单渲染（如果有的话），然后尝试选语言
    setTimeout(() => {
      // 优先 AI 中文，其次第一个可用语言
      const aiItem = document.querySelector(SELECTORS.aiChinese);
      if (aiItem) {
        aiItem.click();
        log('已选择 AI 中文字幕 ✓');
      } else {
        const langItems = document.querySelectorAll(SELECTORS.languageItem);
        if (langItems.length > 0) {
          langItems[0].click();
          log('已选择字幕:', langItems[0].getAttribute('data-lan'), '✓');
        }
        // 如果没找到语言项，可能是 click 已经直接 toggle 了（之前选过语言）
      }

      enabled = true;
    }, CONFIG.MENU_DELAY);

    return true;
  }

  /**
   * 带重试的开启字幕
   */
  function tryEnableWithRetry() {
    if (!featureEnabled) {
      log('功能已关闭，跳过字幕开启');
      return;
    }
    // 清除之前的定时器
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    retryCount = 0;
    enabled = false;

    function attempt() {
      if (enabled) return;

      const success = enableSubtitle();

      if (enabled) {
        log('字幕成功开启 ✓');
        return;
      }

      retryCount++;
      if (retryCount >= CONFIG.MAX_RETRIES) {
        warn(`已达到最大重试次数 (${CONFIG.MAX_RETRIES})，停止尝试`);
        return;
      }

      retryTimer = setTimeout(attempt, CONFIG.RETRY_INTERVAL);
    }

    // 首次尝试稍等一会，确保播放器加载完成
    retryTimer = setTimeout(attempt, CONFIG.INITIAL_DELAY);
  }

  // ========== SPA 导航处理 ==========

  let lastUrl = location.href;
  let urlCheckTimer = null;

  /**
   * 拦截 history.pushState
   */
  const originalPushState = history.pushState.bind(history);
  history.pushState = function (...args) {
    originalPushState(...args);
    // pushState 后 URL 可能异步变化，延迟检查
    setTimeout(onUrlChange, 0);
    setTimeout(onUrlChange, 500);
    setTimeout(onUrlChange, 1500);
  };

  /**
   * 拦截 history.replaceState
   */
  const originalReplaceState = history.replaceState.bind(history);
  history.replaceState = function (...args) {
    originalReplaceState(...args);
    setTimeout(onUrlChange, 0);
    setTimeout(onUrlChange, 500);
  };

  /**
   * 监听浏览器的后退/前进
   */
  window.addEventListener('popstate', () => {
    setTimeout(onUrlChange, 100);
  });

  /**
   * 监听 hashchange（部分 SPA 框架使用 hash 路由）
   */
  window.addEventListener('hashchange', () => {
    onUrlChange();
  });

  /**
   * 轮询检测 URL 变化（兜底方案，捕获所有导航方式）
   */
  function startUrlPolling() {
    if (urlCheckTimer) return;
    urlCheckTimer = setInterval(() => {
      const currentUrl = location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        log('检测到 URL 变化（轮询），重新开启字幕');
        resetAndEnable();
      }
    }, 1000);
    log('已启动 URL 轮询监听');
  }

  /**
   * URL 变化时的处理
   */
  function onUrlChange() {
    const currentUrl = location.href;
    if (currentUrl === lastUrl) return;

    lastUrl = currentUrl;
    log('检测到页面切换，重新开启字幕');
    resetAndEnable();
  }

  // ========== 播放器 DOM 重建检测 ==========

  /**
   * 使用 MutationObserver 监听 document.body
   * B 站切换视频时播放器 DOM 可能被完全替换，
   * 监听 body 级别才能可靠捕获播放器重建
   */
  let observer = null;
  // 防抖：避免重复触发
  let debounceTimer = null;
  // 记录上次检测到的播放器元素，用于判断是否发生了替换
  let lastPlayerElement = null;

  function setupPlayerObserver() {
    if (observer) {
      observer.disconnect();
    }

    // 监听 body 级别的子树变化，确保能捕获播放器容器的替换
    observer = new MutationObserver((mutations) => {
      // 快速检查是否有播放器相关的 DOM 变化
      let playerChanged = false;
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === 1 && (
              node.id === 'bpx-player-container' ||
              node.classList?.contains('bpx-player-container') ||
              node.querySelector?.('#bpx-player-container, .bpx-player-container')
            )) {
              playerChanged = true;
              break;
            }
          }
          if (!playerChanged) {
            for (const node of mutation.removedNodes) {
              if (node.nodeType === 1 && (
                node.id === 'bpx-player-container' ||
                node.classList?.contains('bpx-player-container') ||
                node.querySelector?.('#bpx-player-container, .bpx-player-container')
              )) {
                playerChanged = true;
                break;
              }
            }
          }
        }
        if (playerChanged) break;
      }

      if (!playerChanged) return;

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        // 检查播放器是否真的被替换了
        const currentPlayer = document.querySelector('#bpx-player-container')
          || document.querySelector('.bpx-player-container');
        if (currentPlayer && currentPlayer !== lastPlayerElement) {
          lastPlayerElement = currentPlayer;
          if (!checkSubtitleActive()) {
            enabled = false;
            log('检测到播放器重建，重新开启字幕');
            resetAndEnable();
          }
        }
      }, 1000);
    });

    observer.observe(document.body, { childList: true, subtree: true });
    log('已挂载播放器 DOM 监听（body 级别）');
  }

  /**
   * 检查字幕按钮是否处于激活态（不改变状态）
   */
  function checkSubtitleActive() {
    const btn = document.querySelector(SELECTORS.subtitleBtn);
    if (!btn) return false;
    return (
      btn.classList.contains('bpx-player-state-active') ||
      btn.getAttribute('aria-pressed') === 'true'
    );
  }

  /**
   * 重置状态并开启字幕
   */
  function resetAndEnable() {
    if (!featureEnabled) return;
    // 清除之前的重试
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    enabled = false;
    // 延迟等待新播放器加载
    setTimeout(() => {
      tryEnableWithRetry();
    }, CONFIG.NAVIGATION_DELAY);
  }

  // ========== 启动 ==========

  // 读取功能开关状态
  chrome.storage.sync.get({ enabled: true }, (result) => {
    featureEnabled = result.enabled;
    log('扩展已加载，功能状态:', featureEnabled ? '开启' : '关闭');
    if (featureEnabled) {
      tryEnableWithRetry();
      setTimeout(() => {
        setupPlayerObserver();
        lastPlayerElement = document.querySelector('#bpx-player-container')
          || document.querySelector('.bpx-player-container');
      }, CONFIG.INITIAL_DELAY);
      startUrlPolling();
    }
  });

  // 监听开关状态变化
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.enabled !== undefined) {
      featureEnabled = changes.enabled.newValue;
      log('功能状态变更为:', featureEnabled ? '开启' : '关闭');
      if (featureEnabled) {
        // 开启 → 立即尝试开启字幕
        resetAndEnable();
        setupPlayerObserver();
        startUrlPolling();
      } else {
        // 关闭 → 停止所有重试和监听
        if (retryTimer) {
          clearTimeout(retryTimer);
          retryTimer = null;
        }
        if (urlCheckTimer) {
          clearInterval(urlCheckTimer);
          urlCheckTimer = null;
        }
        if (observer) {
          observer.disconnect();
          observer = null;
        }
        log('已停止所有字幕自动开启逻辑');
      }
    }
  });
})();
