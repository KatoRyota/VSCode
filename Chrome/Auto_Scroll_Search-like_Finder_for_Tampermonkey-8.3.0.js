// ==UserScript==
// @name         Auto Scroll Search-like Finder for Tampermonkey (stable refactor)
// @namespace    https://example.com/
// @version      8.3.0
// @description  Search page text while auto-scrolling until found. Refactored for maintainability and stability.
// @match        *://video.unext.jp/*
// @match        *://cliq.alhinc.jp/*
// @grant        GM_registerMenuCommand
// @grant        window.onurlchange
// @noframes
// @run-at       document-body
// ==/UserScript==

(() => {
  'use strict';

  const APP_KEY = '__TMASS_V830_APP__';
  if (window[APP_KEY]?.initialized) return;

  const Config = Object.freeze({
    version: '8.3.0',
    hostId: 'tmass-host',
    highlightStyleId: 'tmass-highlight-style',
    customHighlightName: 'tmass-current-match',
    zIndexUI: 2147483647,

    maxMatches: 120,
    maxTextNodes: 5000,
    defaultMaxScrolls: 8000,

    scrollIntervalMs: 700,
    stuckWaitMs: 2200,
    stuckThreshold: 5,
    minScrollPx: 140,
    scrollRatio: 0.9,

    minElementArea: 36,
    minUsableBlockHeight: 18,

    shortContextChars: 24,
    longContextChars: 80,
    ancestorDepth: 4,

    relocateMinScore: 140,
    relocateTieGap: 18,
    shortMatchPenaltyThreshold: 3,

    panelClearancePx: 12,
    panelViewportMarginPx: 8,
    panelTopPx: 12,
    panelRightPx: 12,
    panelMaxWidthPx: 760,

    navViewportMarginPx: 24,
    navMaxScrollPx: 1200,

    scrollDetectEpsilonPx: 1,
    scrollEndEpsilonPx: 1,
    endConfirmThreshold: 3,
    maxScrollCandidates: 8,
    maxProbeCandidates: 12,
    probeScrollPx: 12,

    searchEveryNScrolls: 2,
    mutationRescanCooldownMs: 300,
    searchMinIntervalMs: 250,

    enableGlobalHotkeysByDefault: false,
    enableSelectionFallback: false,

    menuIds: {
      show: 'tmass-menu-show',
      hide: 'tmass-menu-hide',
      hotkeysOn: 'tmass-menu-hotkeys-on',
      hotkeysOff: 'tmass-menu-hotkeys-off'
    },

    i18n: {
      title: 'Auto Scroll Search-like Finder v8.3.0',
      showPanel: '検索パネルを表示',
      hidePanel: '検索パネルを非表示',
      hotkeysOn: 'グローバルショートカットを有効化',
      hotkeysOff: 'グローバルショートカットを無効化',
      shown: '表示しました',
      hidden: '非表示にしました',
      waiting: '待機中',
      searchingStarted: '検索開始',
      searchingAuto: '自動スクロール中',
      foundCount: (n) => `一致 ${n}件`,
      foundStopped: '一致を検出して停止',
      foundDetected: '一致を検出',
      noQuery: '検索語を入力してください',
      invalidRegex: '正規表現が不正です',
      noMatch: '一致なし',
      cleared: '結果をクリアしました',
      stopped: '停止しました',
      panelClosedStop: 'パネルを閉じたため停止',
      endReached: '終端到達: 見つかりませんでした',
      limitReached: '上限到達: 見つかりませんでした',
      navLost: (dir) => `${dir}へ移動できません。現在の一致は失われました`,
      navNone: (dir) => `${dir}へ移動できません。一致がありません`,
      spaReset: 'ページ遷移を検出したため状態をリセットしました',
      domChanged: 'ページ内容の変化を検出',
      hide: '閉じる',
      findHere: '現在位置で検索',
      startAuto: '自動検索開始',
      stop: '停止',
      prev: '前',
      next: '次',
      clear: '結果クリア',
      caseSensitive: '大文字小文字',
      wholeWord: '単語一致',
      regex: '正規表現',
      queryPlaceholder: '検索語',
      help: 'Enter=現在位置で検索 / Shift+Enter=自動検索開始 / Esc=停止（パネル表示中のみ）',
      wholeWordNote: '「単語一致」は英数字中心です。日本語では期待どおりにならない場合があります。',
      hotkeysEnabled: 'グローバルショートカットを有効化しました',
      hotkeysDisabled: 'グローバルショートカットを無効化しました'
    },

    defaults: {
      caseSensitive: false,
      wholeWord: false,
      useRegex: false,
      showToolbar: false,
      enableGlobalHotkeys: false
    }
  });

  function createState() {
    return {
      options: {
        ...Config.defaults,
        enableGlobalHotkeys: Config.enableGlobalHotkeysByDefault
      },
      lastKnownUrl: location.href,
      domChangedSinceLastSearch: true,

      search: {
        query: '',
        isRunning: false,
        maxScrolls: Config.defaultMaxScrolls,
        scrollCount: 0,
        samePositionCount: 0,
        endLikeCount: 0,
        matches: [],
        activeIndex: -1,
        timerId: null,
        activeSnapshot: null,
        uiStatus: 'idle',
        uiMessage: Config.i18n.waiting,
        lastSearchRunAt: 0
      },

      cache: {
        lastQueryKey: '',
        lastResults: [],
        lastSearchAt: 0
      },

      scroll: {
        lockedTarget: null,
        candidates: [],
        candidateIndex: -1
      }
    };
  }

  const Runtime = {
    initialized: false,
    destroyed: false,
    listeners: [],
    intervals: [],
    timeouts: [],
    domObserver: null,
    bodyWaitObserver: null,
    historyWrapped: false,
    menuEntries: new Map()
  };

  const State = createState();

  const DomUtils = {
    getDocumentScroller() {
      return document.scrollingElement || document.documentElement || document.body;
    },

    normalizeText(str) {
      return String(str || '')
        .replace(/\u00A0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    },

    escapeRegExp(str) {
      return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    },

    getElementArea(rect) {
      return rect ? Math.max(0, rect.width) * Math.max(0, rect.height) : 0;
    },

    isEditable(el) {
      if (!(el instanceof Element)) return false;
      if (el.isContentEditable) return true;
      if (el.closest('[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]')) return true;
      return ['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(el.tagName);
    },

    isInsideUi(el) {
      return el instanceof Element && !!el.closest(`#${Config.hostId}`);
    },

    isLightweightVisible(el) {
      if (!(el instanceof Element)) return false;
      if (el.hidden) return false;
      if (el.getAttribute('aria-hidden') === 'true') return false;
      return true;
    },

    isVisible(el) {
      if (!(el instanceof Element)) return false;
      if (!this.isLightweightVisible(el)) return false;

      const style = getComputedStyle(el);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        style.opacity === '0'
      ) {
        return false;
      }

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      if (this.getElementArea(rect) < Config.minElementArea) return false;

      return true;
    },

    shouldExcludeElement(el) {
      if (!(el instanceof Element)) return true;
      if (this.isInsideUi(el)) return true;
      if (this.isEditable(el)) return true;
      if (!this.isLightweightVisible(el)) return true;

      const tag = el.tagName;
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'OPTION', 'SELECT'].includes(tag)) return true;
      if (el.closest('script, style, noscript, textarea, input, option, select')) return true;

      try {
        const style = getComputedStyle(el);
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.visibility === 'collapse' ||
          style.opacity === '0'
        ) return true;

        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return true;
        if (rect.height < Config.minUsableBlockHeight && rect.width < 40) return true;
      } catch (_) {
        return true;
      }

      return false;
    },

    isScrollableByStyle(style) {
      return /(auto|scroll|overlay)/.test(style.overflowY);
    },

    hasScrollableSpace(el) {
      return (el.scrollHeight - el.clientHeight) > 40;
    },

    isLikelyChatContainer(el) {
      if (!(el instanceof Element)) return false;

      try {
        if (el.closest('[role="log"]')) return true;
      } catch (_) {}

      const role = (el.getAttribute('role') || '').toLowerCase();
      if (role === 'log' || role === 'feed') return true;

      const ariaLabel = (
        el.getAttribute('aria-label') ||
        el.getAttribute('aria-labelledby') ||
        ''
      ).toLowerCase();

      const dataText = [
        el.id || '',
        typeof el.className === 'string' ? el.className : '',
        el.getAttribute('data-testid') || '',
        el.getAttribute('data-role') || '',
        el.getAttribute('data-component') || ''
      ].join(' ').toLowerCase();

      return /(chat|message|messages|conversation|thread|log|history)/.test(`${ariaLabel} ${dataText}`);
    },

    getChatPriorityAncestor(el) {
      if (!(el instanceof Element)) return null;
      let cur = el;

      while (cur) {
        if (cur.id === Config.hostId) {
          cur = cur.parentElement;
          continue;
        }

        if (cur instanceof HTMLElement && this.isVisible(cur)) {
          const style = getComputedStyle(cur);
          if (this.isScrollableByStyle(style) && this.hasScrollableSpace(cur) && this.isLikelyChatContainer(cur)) {
            return cur;
          }
        }
        cur = cur.parentElement;
      }
      return null;
    },

    getScrollableAncestor(el) {
      if (!(el instanceof Element)) return this.getDocumentScroller();

      const chatAncestor = this.getChatPriorityAncestor(el);
      if (chatAncestor) return chatAncestor;

      let cur = el.parentElement;
      while (cur) {
        if (cur.id === Config.hostId) {
          cur = cur.parentElement;
          continue;
        }
        if (!this.isVisible(cur)) {
          cur = cur.parentElement;
          continue;
        }
        const style = getComputedStyle(cur);
        if (this.isScrollableByStyle(style) && this.hasScrollableSpace(cur)) {
          return cur;
        }
        cur = cur.parentElement;
      }
      return this.getDocumentScroller();
    },

    getScrollTop(el) {
      const docScroller = this.getDocumentScroller();
      if (!el || el === window || el === document.body || el === document.documentElement || el === docScroller) {
        return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
      }
      return el.scrollTop;
    },

    setScrollTop(el, value) {
      const docScroller = this.getDocumentScroller();
      if (!el || el === window || el === document.body || el === document.documentElement || el === docScroller) {
        window.scrollTo(window.scrollX || 0, value);
        return;
      }
      el.scrollTop = value;
    },

    getMaxScrollTop(el) {
      const docScroller = this.getDocumentScroller();
      if (!el || el === window || el === document.body || el === document.documentElement || el === docScroller) {
        const scroller = docScroller;
        return Math.max(0, (scroller.scrollHeight || 0) - (window.innerHeight || scroller.clientHeight || 0));
      }
      return Math.max(0, el.scrollHeight - el.clientHeight);
    },

    isAtScrollEnd(el, epsilon = Config.scrollEndEpsilonPx) {
      const maxScrollTop = this.getMaxScrollTop(el);
      const current = this.getScrollTop(el);
      return Math.abs(maxScrollTop - current) <= epsilon || current >= maxScrollTop;
    },

    getScrollStepSize(el) {
      const docScroller = this.getDocumentScroller();
      if (!el || el === window || el === document.body || el === document.documentElement || el === docScroller) {
        return Math.max(Math.floor(window.innerHeight * Config.scrollRatio), Config.minScrollPx);
      }
      return Math.max(Math.floor(el.clientHeight * Config.scrollRatio), Config.minScrollPx);
    },

    scrollByOn(el, delta) {
      const docScroller = this.getDocumentScroller();
      if (!el || el === window || el === document.body || el === document.documentElement || el === docScroller) {
        window.scrollBy(0, delta);
      } else {
        el.scrollTop += delta;
      }
    },

    scrollByOnWithBehavior(el, delta, smooth = true) {
      const behavior = smooth ? 'smooth' : 'instant';
      const docScroller = this.getDocumentScroller();
      try {
        if (!el || el === window || el === document.body || el === document.documentElement || el === docScroller) {
          window.scrollBy({ top: delta, behavior });
        } else if (typeof el.scrollBy === 'function') {
          el.scrollBy({ top: delta, behavior });
        } else {
          el.scrollTop += delta;
        }
      } catch (_) {
        this.scrollByOn(el, delta);
      }
    },

    getTextSampleAround(text, start, end, size) {
      return {
        before: text.slice(Math.max(0, start - size), start),
        after: text.slice(end, Math.min(text.length, end + size))
      };
    },

    getAncestorTagPath(el, depth = Config.ancestorDepth) {
      const parts = [];
      let cur = el;
      let count = 0;
      while (cur && cur instanceof Element && count < depth) {
        parts.push(cur.tagName);
        cur = cur.parentElement;
        count += 1;
      }
      return parts.join('>');
    },

    rangeLooksAlive(range) {
      if (!(range instanceof Range)) return false;
      try {
        const start = range.startContainer;
        const end = range.endContainer;
        if (!start || !end) return false;
        if (!document.contains(start)) return false;
        if (!document.contains(end)) return false;
        return true;
      } catch (_) {
        return false;
      }
    },

    ensureRange(item) {
      if (!item) return null;
      if (item.range && this.rangeLooksAlive(item.range)) return item.range;

      try {
        const node = item.node;
        if (!(node instanceof Text)) return null;
        if (!document.contains(node)) return null;
        const value = node.nodeValue || '';
        if (item.start < 0 || item.end > value.length || item.start >= item.end) return null;

        const range = document.createRange();
        range.setStart(node, item.start);
        range.setEnd(node, item.end);
        item.range = range;
        return range;
      } catch (_) {
        return null;
      }
    },

    getBestRectFromRange(range) {
      if (!(range instanceof Range)) return null;
      try {
        const rects = Array.from(range.getClientRects ? range.getClientRects() : []);
        const usable = rects.filter(r => r && r.width > 0 && r.height > 0);
        if (usable.length > 0) {
          usable.sort((a, b) => (b.width * b.height) - (a.width * a.height));
          return usable[0];
        }
        const rect = range.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) return rect;
      } catch (_) {}
      return null;
    },

    getRangeAnchorElement(range) {
      try {
        if (!(range instanceof Range)) return null;
        const node = range.commonAncestorContainer || range.startContainer;
        if (!node) return null;
        if (node.nodeType === Node.TEXT_NODE) return node.parentElement || null;
        return node instanceof Element ? node : null;
      } catch (_) {
        return null;
      }
    }
  };

  const Highlighter = {
    mode: 'none',

    supportsCustomHighlight() {
      return typeof window.Highlight === 'function' &&
        typeof CSS !== 'undefined' &&
        CSS &&
        CSS.highlights &&
        typeof CSS.highlights.set === 'function' &&
        typeof CSS.highlights.delete === 'function';
    },

    ensureStyle() {
      let style = document.getElementById(Config.highlightStyleId);
      if (style) return;

      style = document.createElement('style');
      style.id = Config.highlightStyleId;
      style.textContent = `
        ::highlight(${Config.customHighlightName}) {
          background-color: #ffe36a;
          color: #111;
        }
      `;
      (document.head || document.documentElement)?.appendChild(style);
    },

    clear() {
      if (this.mode === 'custom' && this.supportsCustomHighlight()) {
        try { CSS.highlights.delete(Config.customHighlightName); } catch (_) {}
      }
      if (this.mode === 'selection') {
        try {
          const selection = window.getSelection();
          if (selection) selection.removeAllRanges();
        } catch (_) {}
      }
      this.mode = 'none';
    },

    apply(range) {
      if (!(range instanceof Range)) {
        this.clear();
        return;
      }

      if (this.supportsCustomHighlight()) {
        try {
          const highlight = new window.Highlight(range.cloneRange());
          CSS.highlights.set(Config.customHighlightName, highlight);
          try {
            const selection = window.getSelection();
            if (selection) selection.removeAllRanges();
          } catch (_) {}
          this.mode = 'custom';
          return;
        } catch (_) {}
      }

      if (!Config.enableSelectionFallback) {
        this.mode = 'none';
        return;
      }

      try {
        const active = document.activeElement;
        if (
          active &&
          (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)
        ) {
          this.mode = 'none';
          return;
        }

        const selection = window.getSelection();
        if (!selection) return;
        selection.removeAllRanges();
        selection.addRange(range);
        this.mode = 'selection';
      } catch (_) {
        this.mode = 'none';
      }
    }
  };

  const FinderEngine = {
    makeQueryKey(query) {
      return JSON.stringify({
        query: String(query || ''),
        caseSensitive: !!State.options.caseSensitive,
        wholeWord: !!State.options.wholeWord,
        useRegex: !!State.options.useRegex
      });
    },

    invalidateCache() {
      State.cache.lastQueryKey = '';
      State.cache.lastResults = [];
      State.cache.lastSearchAt = 0;
    },

    buildRegex(query) {
      let source = State.options.useRegex ? query : DomUtils.escapeRegExp(query);
      if (State.options.wholeWord) source = `\\b${source}\\b`;

      try {
        return new RegExp(source, State.options.caseSensitive ? 'g' : 'gi');
      } catch (_) {
        return null;
      }
    },

    collectTextNodes(root = document.body) {
      const base = root || document.body;
      if (!base) return [];

      const nodes = [];
      const walker = document.createTreeWalker(
        base,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
            if (DomUtils.shouldExcludeElement(parent)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );

      let current;
      while ((current = walker.nextNode())) {
        nodes.push(current);
        if (nodes.length >= Config.maxTextNodes) break;
      }
      return nodes;
    },

    isCandidateRenderable(node, start, end) {
      try {
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);
        const rect = range.getBoundingClientRect();
        return !!rect && (rect.width > 0 || rect.height > 0);
      } catch (_) {
        return false;
      }
    },

    makeSnapshot(node, matchIndex, matchedText, start, end) {
      const parent = node.parentElement || null;
      const text = node.nodeValue || '';
      const shortCtx = DomUtils.getTextSampleAround(text, start, end, Config.shortContextChars);
      const longCtx = DomUtils.getTextSampleAround(text, start, end, Config.longContextChars);

      return {
        text: matchedText,
        normalizedText: DomUtils.normalizeText(matchedText),
        index: matchIndex,
        contextBeforeShort: DomUtils.normalizeText(shortCtx.before),
        contextAfterShort: DomUtils.normalizeText(shortCtx.after),
        contextBeforeLong: DomUtils.normalizeText(longCtx.before),
        contextAfterLong: DomUtils.normalizeText(longCtx.after),
        containerHint: parent ? DomUtils.getScrollableAncestor(parent) : DomUtils.getDocumentScroller(),
        nodeHint: parent,
        parentTag: parent ? parent.tagName : '',
        ancestorPath: parent ? DomUtils.getAncestorTagPath(parent) : ''
      };
    },

    search(query, options = {}) {
      if (!query) return [];

      const now = Date.now();
      const queryKey = this.makeQueryKey(query);
      const useCache = !!options.allowCache;

      if (
        useCache &&
        !State.domChangedSinceLastSearch &&
        State.cache.lastQueryKey === queryKey &&
        (now - State.cache.lastSearchAt) < Config.searchMinIntervalMs
      ) {
        return State.cache.lastResults;
      }

      const regex = this.buildRegex(query);
      if (!regex) return null;

      let root = document.body;
      const hint = State.search.activeSnapshot?.containerHint;
      if (hint instanceof Element && document.contains(hint)) root = hint;

      const nodes = this.collectTextNodes(root);
      const results = [];

      for (const node of nodes) {
        const text = node.nodeValue;
        if (!text || !text.trim()) continue;

        regex.lastIndex = 0;
        let match;
        while ((match = regex.exec(text)) !== null) {
          const matchedText = match[0];
          if (!matchedText) break;

          try {
            const start = match.index;
            const end = match.index + matchedText.length;

            if (!this.isCandidateRenderable(node, start, end)) {
              if (matchedText.length === 0) break;
              continue;
            }

            results.push({
              node,
              start,
              end,
              range: null,
              ...this.makeSnapshot(node, results.length, matchedText, start, end)
            });
          } catch (_) {}

          if (results.length >= Config.maxMatches) break;
          if (matchedText.length === 0) break;
        }

        if (results.length >= Config.maxMatches) break;
      }

      State.cache.lastQueryKey = queryKey;
      State.cache.lastResults = results;
      State.cache.lastSearchAt = now;
      State.domChangedSinceLastSearch = false;

      return results;
    },

    scoreCandidateAgainstSnapshot(candidate, snapshot) {
      if (!candidate || !snapshot) return -1;

      let score = 0;
      if (candidate.normalizedText === snapshot.normalizedText) score += 100;
      if (candidate.text === snapshot.text) score += 20;

      if (candidate.contextBeforeLong === snapshot.contextBeforeLong) score += 60;
      else if (snapshot.contextBeforeLong && candidate.contextBeforeLong.endsWith(snapshot.contextBeforeLong.slice(-20))) score += 26;

      if (candidate.contextAfterLong === snapshot.contextAfterLong) score += 60;
      else if (snapshot.contextAfterLong && candidate.contextAfterLong.startsWith(snapshot.contextAfterLong.slice(0, 20))) score += 26;

      if (candidate.contextBeforeShort === snapshot.contextBeforeShort) score += 25;
      if (candidate.contextAfterShort === snapshot.contextAfterShort) score += 25;
      if (candidate.parentTag && candidate.parentTag === snapshot.parentTag) score += 20;
      if (candidate.ancestorPath && candidate.ancestorPath === snapshot.ancestorPath) score += 35;
      if (candidate.nodeHint && snapshot.nodeHint && candidate.nodeHint === snapshot.nodeHint) score += 30;
      if (candidate.containerHint && snapshot.containerHint && candidate.containerHint === snapshot.containerHint) score += 40;

      const idxGap = Math.abs((candidate.index ?? 0) - (snapshot.index ?? 0));
      score += Math.max(0, 15 - Math.min(idxGap, 15));

      if ((snapshot.normalizedText || '').length <= Config.shortMatchPenaltyThreshold) score -= 18;

      return score;
    },

    relocateMatch(snapshot, currentResults) {
      if (!snapshot || !currentResults || currentResults.length === 0) {
        return { item: null, ambiguous: false, score: -1 };
      }

      let best = null;
      let bestScore = -1;
      let secondBestScore = -1;

      const nearby = currentResults.filter(item => {
        if (snapshot.containerHint && item.containerHint === snapshot.containerHint) return true;
        if (snapshot.parentTag && item.parentTag === snapshot.parentTag) return true;
        if (snapshot.ancestorPath && item.ancestorPath === snapshot.ancestorPath) return true;
        return false;
      });

      const pool = nearby.length > 0 ? nearby : currentResults;

      for (const item of pool) {
        const score = this.scoreCandidateAgainstSnapshot(item, snapshot);
        if (score > bestScore) {
          secondBestScore = bestScore;
          bestScore = score;
          best = item;
        } else if (score > secondBestScore) {
          secondBestScore = score;
        }
      }

      const ambiguous = bestScore < Config.relocateMinScore ||
        ((bestScore - secondBestScore) < Config.relocateTieGap);

      return {
        item: best || currentResults[0] || null,
        ambiguous,
        score: bestScore
      };
    }
  };

  const ScrollEngine = {
    reset() {
      State.scroll.lockedTarget = null;
      State.scroll.candidates = [];
      State.scroll.candidateIndex = -1;
    },

    getScrollableElements() {
      return Array.from(document.querySelectorAll('body *')).filter(el => {
        if (!(el instanceof HTMLElement)) return false;
        if (el.id === Config.hostId) return false;
        if (!DomUtils.isVisible(el)) return false;
        if (DomUtils.isEditable(el)) return false;
        if (el.clientHeight < 100) return false;

        const style = getComputedStyle(el);
        return DomUtils.isScrollableByStyle(style) || DomUtils.hasScrollableSpace(el);
      });
    },

    isUsableScrollable(el) {
      if (!el) return false;
      if (el instanceof Element && !document.contains(el)) return false;

      const docScroller = DomUtils.getDocumentScroller();
      if (el === docScroller || el === document.documentElement || el === document.body) return true;
      if (!(el instanceof HTMLElement)) return false;
      if (!DomUtils.isVisible(el)) return false;

      const style = getComputedStyle(el);
      return DomUtils.isScrollableByStyle(style) || DomUtils.hasScrollableSpace(el);
    },

    probeScrollable(el) {
      try {
        if (!this.isUsableScrollable(el)) return false;
        const maxScrollTop = DomUtils.getMaxScrollTop(el);
        if (maxScrollTop <= Config.scrollDetectEpsilonPx) return false;

        const before = DomUtils.getScrollTop(el);
        const probeDelta = Math.min(Config.probeScrollPx, Math.max(1, maxScrollTop - before));
        if (probeDelta <= 0) return false;

        DomUtils.setScrollTop(el, before + probeDelta);
        const after = DomUtils.getScrollTop(el);
        DomUtils.setScrollTop(el, before);

        return Math.abs(after - before) >= Config.scrollDetectEpsilonPx;
      } catch (_) {
        return false;
      }
    },

    scoreElement(el) {
      const docScroller = DomUtils.getDocumentScroller();
      if (!el) return -1;

      let score = 0;
      if (el === docScroller || el === document.documentElement || el === document.body) score += 900;

      if (el instanceof HTMLElement) {
        const rect = el.getBoundingClientRect();
        score += Math.min(rect.width * rect.height / 400, 4000);

        const style = getComputedStyle(el);
        if (DomUtils.isScrollableByStyle(style)) score += 1200;
        if (DomUtils.hasScrollableSpace(el)) score += 900;
        if (rect.height > window.innerHeight * 0.5) score += 1200;
        if (rect.width > window.innerWidth * 0.5) score += 500;
        if (DomUtils.isLikelyChatContainer(el)) score += 2200;
        if ((el.getAttribute('role') || '').toLowerCase() === 'log') score += 1800;

        const centerPenalty = Math.abs((rect.top + rect.height / 2) - (window.innerHeight / 2));
        score -= Math.min(centerPenalty, 500);
      }

      return score;
    },

    buildCandidateList() {
      const docScroller = DomUtils.getDocumentScroller();
      const raw = [docScroller, document.documentElement, document.body, ...this.getScrollableElements()].filter(Boolean);

      const unique = [];
      const seen = new Set();
      for (const el of raw) {
        if (!el || seen.has(el)) continue;
        seen.add(el);
        unique.push(el);
      }

      unique.sort((a, b) => this.scoreElement(b) - this.scoreElement(a));

      const top = unique.slice(0, Config.maxProbeCandidates);
      const movable = [];
      const nonMovable = [];

      for (const el of top) {
        if (this.probeScrollable(el)) movable.push(el);
        else nonMovable.push(el);
      }

      const remaining = unique.slice(Config.maxProbeCandidates);
      const reordered = [...movable, ...nonMovable, ...remaining];

      State.scroll.candidates = reordered.slice(0, Config.maxScrollCandidates);
      State.scroll.candidateIndex = State.scroll.candidates.length > 0 ? 0 : -1;
      State.scroll.lockedTarget = State.scroll.candidateIndex >= 0
        ? State.scroll.candidates[State.scroll.candidateIndex]
        : docScroller;

      return State.scroll.lockedTarget;
    },

    promoteHintToPrimary(hint) {
      if (!this.isUsableScrollable(hint)) return false;
      const existing = State.scroll.candidates.filter(el => el !== hint);
      State.scroll.candidates = [hint, ...existing].slice(0, Config.maxScrollCandidates);
      State.scroll.candidateIndex = 0;
      State.scroll.lockedTarget = hint;
      return true;
    },

    getLockedTarget() {
      if (this.isUsableScrollable(State.scroll.lockedTarget)) return State.scroll.lockedTarget;
      return this.buildCandidateList();
    },

    switchToNextCandidate() {
      if (!State.scroll.candidates.length) this.buildCandidateList();

      for (let i = State.scroll.candidateIndex + 1; i < State.scroll.candidates.length; i += 1) {
        const candidate = State.scroll.candidates[i];
        if (this.isUsableScrollable(candidate)) {
          State.scroll.candidateIndex = i;
          State.scroll.lockedTarget = candidate;
          return candidate;
        }
      }
      return null;
    },

    stepOn(target) {
      const before = DomUtils.getScrollTop(target);
      const delta = DomUtils.getScrollStepSize(target);
      const wasAtEnd = DomUtils.isAtScrollEnd(target);

      DomUtils.scrollByOn(target, delta);

      const after = DomUtils.getScrollTop(target);
      const moved = Math.abs(after - before) >= Config.scrollDetectEpsilonPx;
      const isEndNow = DomUtils.isAtScrollEnd(target);

      return {
        target,
        moved,
        scrollTopBefore: before,
        scrollTopAfter: after,
        wasAtEnd,
        isEndNow,
        cannotAdvance: (!moved && isEndNow) || (wasAtEnd && isEndNow)
      };
    },

    stepWithFailover() {
      const primary = this.getLockedTarget();
      const primaryResult = this.stepOn(primary);

      if (!primaryResult.cannotAdvance) {
        return { ...primaryResult, usedFallback: false, fallbackSucceeded: false };
      }

      const fallback = this.switchToNextCandidate();
      if (!fallback) {
        return { ...primaryResult, usedFallback: false, fallbackSucceeded: false };
      }

      const fallbackResult = this.stepOn(fallback);
      return { ...fallbackResult, usedFallback: true, fallbackSucceeded: !fallbackResult.cannotAdvance };
    }
  };

  const PanelView = {
    host: null,
    shadow: null,
    els: {},

    ensureHost() {
      let host = document.getElementById(Config.hostId);
      if (!host) {
        host = document.createElement('div');
        host.id = Config.hostId;
        host.style.position = 'fixed';
        host.style.top = `${Config.panelTopPx}px`;
        host.style.right = `${Config.panelRightPx}px`;
        host.style.left = 'auto';
        host.style.bottom = 'auto';
        host.style.margin = '0';
        host.style.padding = '0';
        host.style.zIndex = String(Config.zIndexUI);
        host.style.width = `min(${Config.panelMaxWidthPx}px, calc(100vw - 24px))`;
        host.style.maxWidth = 'calc(100vw - 24px)';
        host.style.pointerEvents = 'auto';
        host.style.background = 'transparent';
        host.style.display = 'block';
        host.style.visibility = 'visible';
        host.style.opacity = '1';
        host.style.transform = 'none';
        host.style.contain = 'layout style paint';
        (document.body || document.documentElement).appendChild(host);
      }
      this.host = host;
      return host;
    },

    createShadow() {
      const host = this.ensureHost();
      if (!host.shadowRoot) host.attachShadow({ mode: 'open' });
      this.shadow = host.shadowRoot;
      return this.shadow;
    },

    render() {
      const shadow = this.createShadow();
      shadow.innerHTML = `
        <style>
          :host { all: initial; }
          *, *::before, *::after { box-sizing: border-box; }
          .tmass-anchor {
            position: relative;
            width: 100%;
            min-height: 0;
            color: #fff;
            font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          }
          .tmass-panel {
            display: block;
            width: 100%;
            background: rgba(24,24,24,0.96);
            color: #fff;
            border: 1px solid rgba(255,255,255,0.14);
            border-radius: 12px;
            box-shadow: 0 10px 28px rgba(0,0,0,0.38);
            padding: 10px 12px;
          }
          .tmass-panel[data-hidden="true"] { display: none; }
          .tmass-titlebar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
          }
          .tmass-title {
            font-weight: 700;
            font-size: 13px;
            line-height: 1.2;
          }
          .tmass-topline {
            display: grid;
            grid-template-columns: minmax(0, 1fr) 96px;
            gap: 6px;
            align-items: center;
            margin-bottom: 8px;
          }
          .tmass-actions {
            display: flex;
            gap: 6px;
            align-items: center;
            flex-wrap: wrap;
            margin-bottom: 8px;
          }
          .tmass-actions button { flex: 0 0 auto; }
          .tmass-options {
            display: flex;
            gap: 10px 12px;
            align-items: center;
            flex-wrap: wrap;
            margin-bottom: 6px;
          }
          input[type="text"], input[type="number"] {
            box-sizing: border-box;
            min-width: 0;
            padding: 7px 9px;
            border: 1px solid #666;
            border-radius: 6px;
            background: #111;
            color: #fff;
            font: 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          }
          input[type="text"] { width: 100%; }
          input[type="number"] { width: 96px; }
          button {
            display: inline-block;
            padding: 7px 9px;
            border: 1px solid #666;
            border-radius: 6px;
            background: #222;
            color: #fff;
            font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            cursor: pointer;
            line-height: 1.2;
            white-space: nowrap;
          }
          button:hover { background: #333; }
          button:disabled { opacity: 0.48; cursor: default; }
          label {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            white-space: nowrap;
            font: 12px/1.25 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            color: #fff;
            vertical-align: middle;
          }
          input[type="checkbox"] {
            width: 16px;
            height: 16px;
            min-width: 16px;
            min-height: 16px;
            margin: 0;
            padding: 0;
            vertical-align: middle;
            accent-color: #4da3ff;
            appearance: auto;
            -webkit-appearance: checkbox;
          }
          .tmass-meta {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            font: 12px/1.25 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            color: rgba(255,255,255,0.92);
            margin-top: 2px;
          }
          .tmass-help {
            margin-top: 4px;
            font: 10px/1.25 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            color: rgba(255,255,255,0.72);
            white-space: normal;
          }
          .tmass-note {
            margin-top: 6px;
            font: 10px/1.25 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            color: rgba(255,255,255,0.62);
            white-space: normal;
          }
          @media (max-width: 720px) {
            .tmass-topline { grid-template-columns: 1fr; }
          }
        </style>

        <div class="tmass-anchor">
          <div class="tmass-panel" id="tmass-panel">
            <div class="tmass-titlebar">
              <div class="tmass-title">${Config.i18n.title}</div>
              <button id="tmass-hide" type="button">${Config.i18n.hide}</button>
            </div>

            <div class="tmass-topline">
              <input id="tmass-query" type="text" placeholder="${Config.i18n.queryPlaceholder}">
              <input id="tmass-maxscrolls" type="number" min="1" step="1" value="${Config.defaultMaxScrolls}">
            </div>

            <div class="tmass-actions">
              <button id="tmass-find">${Config.i18n.findHere}</button>
              <button id="tmass-start">${Config.i18n.startAuto}</button>
              <button id="tmass-stop" disabled>${Config.i18n.stop}</button>
              <button id="tmass-prev" disabled>${Config.i18n.prev}</button>
              <button id="tmass-next" disabled>${Config.i18n.next}</button>
              <button id="tmass-clear">${Config.i18n.clear}</button>
            </div>

            <div class="tmass-options">
              <label><input id="tmass-case" type="checkbox"> ${Config.i18n.caseSensitive}</label>
              <label><input id="tmass-word" type="checkbox"> ${Config.i18n.wholeWord}</label>
              <label><input id="tmass-regex" type="checkbox"> ${Config.i18n.regex}</label>
            </div>

            <div class="tmass-meta">
              <span id="tmass-count">0件</span>
              <span id="tmass-status">${Config.i18n.waiting}</span>
            </div>

            <div class="tmass-help" title="${Config.i18n.help}">
              ${Config.i18n.help}
            </div>
            <div class="tmass-note">
              ${Config.i18n.wholeWordNote}
            </div>
          </div>
        </div>
      `;

      this.els.panel = shadow.getElementById('tmass-panel');
      this.els.query = shadow.getElementById('tmass-query');
      this.els.maxScrolls = shadow.getElementById('tmass-maxscrolls');
      this.els.find = shadow.getElementById('tmass-find');
      this.els.start = shadow.getElementById('tmass-start');
      this.els.stop = shadow.getElementById('tmass-stop');
      this.els.prev = shadow.getElementById('tmass-prev');
      this.els.next = shadow.getElementById('tmass-next');
      this.els.clear = shadow.getElementById('tmass-clear');
      this.els.hide = shadow.getElementById('tmass-hide');
      this.els.caseSensitive = shadow.getElementById('tmass-case');
      this.els.wholeWord = shadow.getElementById('tmass-word');
      this.els.regex = shadow.getElementById('tmass-regex');
      this.els.count = shadow.getElementById('tmass-count');
      this.els.status = shadow.getElementById('tmass-status');

      this.reflectStateToUi();
      this.applyToolbarVisibility();
    },

    reflectStateToUi() {
      this.els.query.value = State.search.query || '';
      this.els.caseSensitive.checked = State.options.caseSensitive;
      this.els.wholeWord.checked = State.options.wholeWord;
      this.els.regex.checked = State.options.useRegex;
    },

    syncUiToState() {
      State.options.caseSensitive = !!this.els.caseSensitive.checked;
      State.options.wholeWord = !!this.els.wholeWord.checked;
      State.options.useRegex = !!this.els.regex.checked;
      FinderEngine.invalidateCache();
      State.domChangedSinceLastSearch = true;
    },

    renderState() {
      const { isRunning, matches, activeIndex, uiMessage } = State.search;
      const total = matches.length;

      if (this.els.count) {
        if (total <= 0) this.els.count.textContent = '0件';
        else if (activeIndex >= 0 && activeIndex < total) this.els.count.textContent = `${activeIndex + 1}/${total}件`;
        else this.els.count.textContent = `?/${total}件`;
      }

      if (this.els.status) this.els.status.textContent = uiMessage || Config.i18n.waiting;
      if (this.els.start) this.els.start.disabled = !!isRunning;
      if (this.els.stop) this.els.stop.disabled = !isRunning;

      const canNavigate = total > 0 && activeIndex >= 0 && activeIndex < total;
      if (this.els.prev) this.els.prev.disabled = !canNavigate;
      if (this.els.next) this.els.next.disabled = !canNavigate;
    },

    applyToolbarVisibility() {
      const showToolbar = !!State.options.showToolbar;

      if (this.els.panel) {
        this.els.panel.dataset.hidden = showToolbar ? 'false' : 'true';
      }

      if (this.host) {
        this.host.style.width = showToolbar
          ? `min(${Config.panelMaxWidthPx}px, calc(100vw - 24px))`
          : 'auto';
        this.host.style.pointerEvents = showToolbar ? 'auto' : 'none';
      }
    },

    getPanelViewportRect() {
      try {
        if (!State.options.showToolbar) return null;
        if (!this.els.panel || this.els.panel.dataset.hidden === 'true') return null;
        const rect = this.els.panel.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;

        return {
          top: Math.max(0, rect.top - Config.panelViewportMarginPx),
          right: Math.min(window.innerWidth, rect.right + Config.panelViewportMarginPx),
          bottom: Math.min(window.innerHeight, rect.bottom + Config.panelViewportMarginPx),
          left: Math.max(0, rect.left - Config.panelViewportMarginPx)
        };
      } catch (_) {
        return null;
      }
    },

    bind(controller) {
      this.els.find.addEventListener('click', () => {
        this.syncUiToState();
        controller.searchOnly(this.els.query.value);
      });

      this.els.start.addEventListener('click', () => {
        this.syncUiToState();
        controller.start(this.els.query.value, {
          maxScrolls: Number(this.els.maxScrolls.value) || Config.defaultMaxScrolls
        });
      });

      this.els.stop.addEventListener('click', () => controller.stop(Config.i18n.stopped));
      this.els.prev.addEventListener('click', () => controller.goToByOffset(-1, '前'));
      this.els.next.addEventListener('click', () => controller.goToByOffset(1, '次'));
      this.els.clear.addEventListener('click', () => {
        controller.stop('');
        controller.clearSearchResults();
      });
      this.els.hide.addEventListener('click', () => controller.stopAndHide(Config.i18n.hidden));

      [this.els.caseSensitive, this.els.wholeWord, this.els.regex].forEach(el => {
        el.addEventListener('change', () => {
          this.syncUiToState();
          controller.applyCurrentHighlight();
        });
      });

      this.els.query.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.syncUiToState();
          controller.searchOnly(this.els.query.value);
        } else if (e.key === 'Enter' && e.shiftKey) {
          e.preventDefault();
          this.syncUiToState();
          controller.start(this.els.query.value, {
            maxScrolls: Number(this.els.maxScrolls.value) || Config.defaultMaxScrolls
          });
        } else if (e.key === 'Escape' && State.options.showToolbar) {
          e.preventDefault();
          controller.stop(Config.i18n.stopped);
        }
      });

      addManagedEventListener(document, 'keydown', (e) => {
        if (!State.options.enableGlobalHotkeys) return;

        const t = e.target;
        const editing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
        if (editing) return;

        if (e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
          e.preventDefault();
          if (!State.options.showToolbar) setToolbarVisibility(true, Config.i18n.shown);
          this.els.query.focus();
          this.els.query.select();
          return;
        }

        if (e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
          e.preventDefault();
          if (State.search.isRunning) controller.stop(Config.i18n.stopped);
          else {
            this.syncUiToState();
            controller.start(this.els.query.value, {
              maxScrolls: Number(this.els.maxScrolls.value) || Config.defaultMaxScrolls
            });
          }
          return;
        }

        if (e.altKey && !e.shiftKey && e.key.toLowerCase() === 'n') {
          e.preventDefault();
          controller.goToByOffset(1, '次');
          return;
        }

        if (e.altKey && !e.shiftKey && e.key.toLowerCase() === 'p') {
          e.preventDefault();
          controller.goToByOffset(-1, '前');
          return;
        }

        if (e.key === 'Escape' && State.options.showToolbar) {
          e.preventDefault();
          controller.stop(Config.i18n.stopped);
        }
      }, true);
    },

    init(controller) {
      this.render();
      this.bind(controller);
      this.renderState();
    }
  };

  const NavigationController = {
    setUi(status, message) {
      State.search.uiStatus = status;
      State.search.uiMessage = message;
      PanelView.renderState();
    },

    clearTimer() {
      if (State.search.timerId) {
        clearTimeout(State.search.timerId);
        State.search.timerId = null;
      }
    },

    invalidateMatches() {
      State.search.matches = [];
      State.search.activeIndex = -1;
      State.search.activeSnapshot = null;
      Highlighter.clear();
    },

    resetRuntime(message = Config.i18n.waiting) {
      this.clearTimer();
      State.search.isRunning = false;
      State.search.scrollCount = 0;
      State.search.samePositionCount = 0;
      State.search.endLikeCount = 0;
      State.search.lastSearchRunAt = 0;
      this.invalidateMatches();
      ScrollEngine.reset();
      FinderEngine.invalidateCache();
      State.domChangedSinceLastSearch = true;
      this.setUi('idle', message);
    },

    hardResetForNavigation(message = Config.i18n.spaReset) {
      this.resetRuntime(message);
    },

    captureSnapshotFromItem(item) {
      if (!item) return null;
      return {
        text: item.text,
        normalizedText: item.normalizedText,
        index: item.index,
        contextBeforeShort: item.contextBeforeShort,
        contextAfterShort: item.contextAfterShort,
        contextBeforeLong: item.contextBeforeLong,
        contextAfterLong: item.contextAfterLong,
        containerHint: item.containerHint,
        nodeHint: item.nodeHint,
        parentTag: item.parentTag,
        ancestorPath: item.ancestorPath
      };
    },

    searchCurrentDom() {
      if (!State.search.query) return { ok: false, reason: 'NO_QUERY', found: [] };
      const found = FinderEngine.search(State.search.query, { allowCache: true });
      if (found === null) return { ok: false, reason: 'INVALID_REGEX', found: [] };
      return { ok: true, reason: 'OK', found };
    },

    getNavFailureMessage(directionLabel, reason, hadPreviousMatches) {
      if (reason === 'INVALID_REGEX') return Config.i18n.invalidRegex;
      if (reason === 'NO_QUERY') return Config.i18n.noQuery;
      if (reason === 'NO_MATCH') return hadPreviousMatches ? Config.i18n.navLost(directionLabel) : Config.i18n.navNone(directionLabel);
      if (reason === 'NO_SNAPSHOT') return hadPreviousMatches ? Config.i18n.navLost(directionLabel) : Config.i18n.navNone(directionLabel);
      if (reason === 'AMBIGUOUS') return Config.i18n.navLost(directionLabel);
      return Config.i18n.navNone(directionLabel);
    },

    relocateFromSnapshotOrFail(currentFound) {
      const snapshot = State.search.activeSnapshot;
      if (!snapshot) {
        this.invalidateMatches();
        return { ok: false, reason: 'NO_SNAPSHOT' };
      }

      const relocation = FinderEngine.relocateMatch(snapshot, currentFound);
      if (!relocation.item || relocation.ambiguous) {
        this.invalidateMatches();
        return { ok: false, reason: 'AMBIGUOUS' };
      }

      const index = Math.max(0, currentFound.indexOf(relocation.item));
      if (index < 0 || index >= currentFound.length) {
        this.invalidateMatches();
        return { ok: false, reason: 'AMBIGUOUS' };
      }

      return { ok: true, index };
    },

    beginSearchSession(query, options = {}) {
      State.search.query = String(query || '').trim();
      if (!State.search.query) {
        this.setUi('no_query', Config.i18n.noQuery);
        return false;
      }

      State.search.isRunning = true;
      State.search.maxScrolls = Number(options.maxScrolls) || Config.defaultMaxScrolls;
      State.search.scrollCount = 0;
      State.search.samePositionCount = 0;
      State.search.endLikeCount = 0;
      State.search.lastSearchRunAt = 0;

      this.invalidateMatches();
      ScrollEngine.reset();
      ScrollEngine.buildCandidateList();
      FinderEngine.invalidateCache();
      State.domChangedSinceLastSearch = true;
      this.setUi('searching', Config.i18n.searchingStarted);
      return true;
    },

    start(query, options = {}) {
      if (State.search.isRunning) return;
      if (!this.beginSearchSession(query, options)) return;

      const initial = FinderEngine.search(State.search.query, { allowCache: false });
      State.search.lastSearchRunAt = Date.now();

      if (initial === null) {
        State.search.isRunning = false;
        this.setUi('invalid_regex', Config.i18n.invalidRegex);
        return;
      }

      if (initial.length > 0) {
        State.search.matches = initial;
        State.search.activeIndex = 0;
        State.search.activeSnapshot = this.captureSnapshotFromItem(initial[0]);
        if (State.search.activeSnapshot?.containerHint) {
          ScrollEngine.promoteHintToPrimary(State.search.activeSnapshot.containerHint);
        }
        this.setUi('found', Config.i18n.foundCount(initial.length));
        this.scrollActiveIntoView(false, false);
        this.stop(Config.i18n.foundDetected);
        return;
      }

      this.runCycle();
    },

    stop(reason = Config.i18n.stopped) {
      State.search.isRunning = false;
      this.clearTimer();
      if (reason) this.setUi('stopped', reason);
    },

    stopAndHide(reason = Config.i18n.hidden) {
      this.stop(Config.i18n.panelClosedStop);
      Highlighter.clear();
      State.options.showToolbar = false;
      PanelView.applyToolbarVisibility();
      this.setUi('hidden', reason);
    },

    handleAutoSearchHit(found) {
      State.search.matches = found;
      State.search.activeIndex = 0;
      State.search.activeSnapshot = this.captureSnapshotFromItem(found[0]);
      if (State.search.activeSnapshot?.containerHint) {
        ScrollEngine.promoteHintToPrimary(State.search.activeSnapshot.containerHint);
      }
      this.setUi('found', Config.i18n.foundStopped);
      State.search.isRunning = false;
      this.clearTimer();
      this.scrollActiveIntoView(true, false);
    },

    updateAutoSearchProgress(stepResult) {
      State.search.scrollCount += 1;
      State.search.samePositionCount = stepResult.moved ? 0 : State.search.samePositionCount + 1;
      State.search.endLikeCount = stepResult.cannotAdvance ? State.search.endLikeCount + 1 : 0;
    },

    shouldStopAtEnd() {
      return State.search.endLikeCount >= Config.endConfirmThreshold;
    },

    shouldRunSearchThisCycle() {
      if (State.search.scrollCount === 0) return true;
      if (State.domChangedSinceLastSearch) return true;
      if ((State.search.scrollCount % Config.searchEveryNScrolls) === 0) return true;
      return false;
    },

    runCycle() {
      if (!State.search.isRunning) return;

      const stepResult = ScrollEngine.stepWithFailover();
      this.updateAutoSearchProgress(stepResult);

      if (this.shouldRunSearchThisCycle()) {
        const found = FinderEngine.search(State.search.query, { allowCache: true });
        State.search.lastSearchRunAt = Date.now();

        if (found === null) {
          State.search.isRunning = false;
          this.clearTimer();
          this.setUi('invalid_regex', Config.i18n.invalidRegex);
          return;
        }

        if (found.length > 0) {
          this.handleAutoSearchHit(found);
          return;
        }
      }

      if (this.shouldStopAtEnd()) {
        this.stop(Config.i18n.endReached);
        return;
      }

      if (State.search.scrollCount >= State.search.maxScrolls) {
        this.stop(Config.i18n.limitReached);
        return;
      }

      const suffixParts = [];
      if (State.search.samePositionCount > 0) suffixParts.push(`停滞${State.search.samePositionCount}`);
      if (State.search.endLikeCount > 0) suffixParts.push(`終端候補${State.search.endLikeCount}`);
      if (State.domChangedSinceLastSearch) suffixParts.push('DOM変化あり');
      const suffix = suffixParts.length ? ` / ${suffixParts.join(' / ')}` : '';

      this.setUi('searching', `${Config.i18n.searchingAuto} (${State.search.scrollCount})${suffix}`);

      const wait = State.search.samePositionCount >= Config.stuckThreshold
        ? Config.stuckWaitMs
        : Config.scrollIntervalMs;

      State.search.timerId = setTimeout(() => this.runCycle(), wait);
    },

    searchOnly(query) {
      State.search.query = String(query || '').trim();
      this.invalidateMatches();
      FinderEngine.invalidateCache();
      State.domChangedSinceLastSearch = true;

      if (!State.search.query) {
        this.setUi('no_query', Config.i18n.noQuery);
        return;
      }

      const found = FinderEngine.search(State.search.query, { allowCache: false });
      if (found === null) {
        this.setUi('invalid_regex', Config.i18n.invalidRegex);
        return;
      }
      if (found.length === 0) {
        this.setUi('no_match', Config.i18n.noMatch);
        return;
      }

      State.search.matches = found;
      State.search.activeIndex = 0;
      State.search.activeSnapshot = this.captureSnapshotFromItem(found[0]);
      if (State.search.activeSnapshot?.containerHint) {
        ScrollEngine.promoteHintToPrimary(State.search.activeSnapshot.containerHint);
      }
      this.setUi('found', Config.i18n.foundCount(found.length));
      this.scrollActiveIntoView(false, false);
    },

    clearSearchResults(render = true) {
      this.invalidateMatches();
      FinderEngine.invalidateCache();
      State.domChangedSinceLastSearch = true;
      if (render) this.setUi('cleared', Config.i18n.cleared);
    },

    getActiveItem() {
      return State.search.matches[State.search.activeIndex] || null;
    },

    applyCurrentHighlight() {
      const item = this.getActiveItem();
      if (!item) {
        Highlighter.clear();
        return false;
      }

      const range = DomUtils.ensureRange(item);
      if (!range || !DomUtils.rangeLooksAlive(range)) {
        Highlighter.clear();
        return false;
      }

      Highlighter.apply(range);
      return true;
    },

    ensureRectVisibleBelowPanel(targetRect, scroller, smooth = true) {
      if (!targetRect) return;
      const panelRect = PanelView.getPanelViewportRect();
      const topLimit = panelRect ? panelRect.bottom + Config.panelClearancePx : Config.navViewportMarginPx;
      const bottomLimit = window.innerHeight - Config.navViewportMarginPx;

      let delta = 0;
      if (targetRect.top < topLimit) delta = targetRect.top - topLimit;
      else if (targetRect.bottom > bottomLimit) delta = targetRect.bottom - bottomLimit;

      if (!delta) return;
      if (Math.abs(delta) > Config.navMaxScrollPx) delta = Math.sign(delta) * Config.navMaxScrollPx;

      DomUtils.scrollByOnWithBehavior(scroller, delta, smooth);
    },

    goToByOffset(offset, directionLabel = '移動') {
      const hadPreviousMatches = State.search.matches.length > 0 || !!State.search.activeSnapshot;

      const searchResult = this.searchCurrentDom();
      if (!searchResult.ok) {
        this.invalidateMatches();
        this.setUi('nav_failed', this.getNavFailureMessage(directionLabel, searchResult.reason, hadPreviousMatches));
        return;
      }

      if (searchResult.found.length === 0) {
        this.invalidateMatches();
        this.setUi('nav_failed', this.getNavFailureMessage(directionLabel, 'NO_MATCH', hadPreviousMatches));
        return;
      }

      const relocation = this.relocateFromSnapshotOrFail(searchResult.found);
      if (!relocation.ok) {
        this.setUi('nav_failed', this.getNavFailureMessage(directionLabel, relocation.reason, hadPreviousMatches));
        return;
      }

      const total = searchResult.found.length;
      let nextIndex = relocation.index + offset;
      if (nextIndex < 0) nextIndex = total - 1;
      if (nextIndex >= total) nextIndex = 0;

      State.search.matches = searchResult.found;
      State.search.activeIndex = nextIndex;
      State.search.activeSnapshot = this.captureSnapshotFromItem(searchResult.found[nextIndex]);
      if (State.search.activeSnapshot?.containerHint) {
        ScrollEngine.promoteHintToPrimary(State.search.activeSnapshot.containerHint);
      }
      this.setUi('navigated', `${directionLabel}へ移動`);
      this.scrollActiveIntoView(true, false);
    },

    scrollActiveIntoView(smooth = true, renderOnFailure = true) {
      const item = this.getActiveItem();
      if (!item) {
        if (renderOnFailure) {
          this.invalidateMatches();
          this.setUi('no_match', Config.i18n.navLost('移動'));
        }
        return false;
      }

      const range = DomUtils.ensureRange(item);
      if (!range || !DomUtils.rangeLooksAlive(range)) {
        if (renderOnFailure) {
          this.invalidateMatches();
          this.setUi('no_match', Config.i18n.navLost('移動'));
        }
        return false;
      }

      if (item.containerHint) ScrollEngine.promoteHintToPrimary(item.containerHint);

      const rect = DomUtils.getBestRectFromRange(range);
      const anchorEl = DomUtils.getRangeAnchorElement(range);
      const fallbackScroller = anchorEl ? DomUtils.getScrollableAncestor(anchorEl) : DomUtils.getDocumentScroller();
      const scroller = item.containerHint || fallbackScroller;

      if (rect) this.ensureRectVisibleBelowPanel(rect, scroller, smooth);
      this.applyCurrentHighlight();
      return true;
    }
  };

  function addManagedEventListener(target, type, handler, options) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, handler, options);
    Runtime.listeners.push(() => {
      try { target.removeEventListener(type, handler, options); } catch (_) {}
    });
  }

  function setToolbarVisibility(visible, statusText = '') {
    const nextVisible = !!visible;

    if (!nextVisible) {
      NavigationController.stopAndHide(statusText || Config.i18n.hidden);
      return;
    }

    State.options.showToolbar = true;
    PanelView.applyToolbarVisibility();

    if (PanelView.els.query) {
      try {
        PanelView.els.query.focus();
        PanelView.els.query.select();
      } catch (_) {}
    }

    if (statusText) {
      NavigationController.setUi('visible', statusText);
    }
  }

  function setGlobalHotkeysEnabled(enabled) {
    State.options.enableGlobalHotkeys = !!enabled;
    NavigationController.setUi(
      'hotkeys',
      enabled ? Config.i18n.hotkeysEnabled : Config.i18n.hotkeysDisabled
    );
    registerMenu();
  }

  function registerMenuCommand(id, name, callback, title) {
    if (typeof GM_registerMenuCommand !== 'function') return;
    const existing = Runtime.menuEntries.get(id);

    try {
      const returnedId = GM_registerMenuCommand(name, callback, {
        id: existing ?? id,
        title,
        autoClose: true
      });
      Runtime.menuEntries.set(id, returnedId ?? existing ?? id);
    } catch (_) {}
  }

  function registerMenu() {
    registerMenuCommand(
      Config.menuIds.show,
      Config.i18n.showPanel,
      () => setToolbarVisibility(true, Config.i18n.shown),
      Config.i18n.showPanel
    );

    registerMenuCommand(
      Config.menuIds.hide,
      Config.i18n.hidePanel,
      () => setToolbarVisibility(false, Config.i18n.hidden),
      Config.i18n.hidePanel
    );

    registerMenuCommand(
      Config.menuIds.hotkeysOn,
      Config.i18n.hotkeysOn,
      () => setGlobalHotkeysEnabled(true),
      Config.i18n.hotkeysOn
    );

    registerMenuCommand(
      Config.menuIds.hotkeysOff,
      Config.i18n.hotkeysOff,
      () => setGlobalHotkeysEnabled(false),
      Config.i18n.hotkeysOff
    );
  }

  function markDomChanged() {
    State.domChangedSinceLastSearch = true;
    FinderEngine.invalidateCache();
  }

  function observeDomMutations() {
    if (Runtime.domObserver) {
      try { Runtime.domObserver.disconnect(); } catch (_) {}
      Runtime.domObserver = null;
    }

    if (!document.body || typeof MutationObserver !== 'function') return;

    let mutationTimer = null;
    Runtime.domObserver = new MutationObserver((mutations) => {
      if (!mutations || mutations.length === 0) return;

      clearTimeout(mutationTimer);
      mutationTimer = setTimeout(() => {
        markDomChanged();

        const active = NavigationController.getActiveItem();
        if (active) {
          const range = DomUtils.ensureRange(active);
          if (!range || !DomUtils.rangeLooksAlive(range)) {
            NavigationController.invalidateMatches();
            NavigationController.setUi('dom_changed', Config.i18n.domChanged);
          }
        }
      }, Config.mutationRescanCooldownMs);
    });

    Runtime.domObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function waitForBody() {
    return new Promise((resolve) => {
      if (document.body) {
        resolve();
        return;
      }

      if (typeof MutationObserver !== 'function') {
        const timer = setInterval(() => {
          if (document.body) {
            clearInterval(timer);
            resolve();
          }
        }, 50);
        Runtime.intervals.push(timer);
        return;
      }

      const observer = new MutationObserver(() => {
        if (document.body) {
          observer.disconnect();
          resolve();
        }
      });
      Runtime.bodyWaitObserver = observer;

      try {
        observer.observe(document.documentElement || document, {
          childList: true,
          subtree: true
        });
      } catch (_) {
        resolve();
      }
    });
  }

  function handleUrlChange() {
    const nextUrl = location.href;
    if (nextUrl === State.lastKnownUrl) return;
    State.lastKnownUrl = nextUrl;
    NavigationController.hardResetForNavigation(Config.i18n.spaReset);
    observeDomMutations();
  }

  function queueUrlCheck() {
    try {
      queueMicrotask(handleUrlChange);
    } catch (_) {
      setTimeout(handleUrlChange, 0);
    }
  }

  function wrapHistoryMethod(obj, key) {
    try {
      const current = obj[key];
      if (typeof current !== 'function') return;
      if (current.__tmassWrapped__) return;

      function wrappedHistoryMethod(...args) {
        const result = current.apply(this, args);
        queueUrlCheck();
        return result;
      }

      Object.defineProperty(wrappedHistoryMethod, '__tmassWrapped__', {
        value: true,
        configurable: false,
        enumerable: false,
        writable: false
      });

      obj[key] = wrappedHistoryMethod;
    } catch (_) {}
  }

  function installSpaHooks() {
    if (Runtime.historyWrapped) return;
    Runtime.historyWrapped = true;

    if (window.onurlchange === null) {
      addManagedEventListener(window, 'urlchange', handleUrlChange);
    }

    wrapHistoryMethod(history, 'pushState');
    wrapHistoryMethod(history, 'replaceState');

    addManagedEventListener(window, 'popstate', handleUrlChange, true);
    addManagedEventListener(window, 'hashchange', handleUrlChange, true);
  }

  function destroy() {
    Runtime.destroyed = true;

    try { NavigationController.resetRuntime(Config.i18n.hidden); } catch (_) {}

    if (Runtime.domObserver) {
      try { Runtime.domObserver.disconnect(); } catch (_) {}
      Runtime.domObserver = null;
    }

    if (Runtime.bodyWaitObserver) {
      try { Runtime.bodyWaitObserver.disconnect(); } catch (_) {}
      Runtime.bodyWaitObserver = null;
    }

    for (const off of Runtime.listeners.splice(0)) {
      try { off(); } catch (_) {}
    }

    for (const id of Runtime.intervals.splice(0)) clearInterval(id);
    for (const id of Runtime.timeouts.splice(0)) clearTimeout(id);

    Highlighter.clear();

    try {
      const host = document.getElementById(Config.hostId);
      if (host) host.remove();
    } catch (_) {}

    try {
      delete window[APP_KEY];
      delete window.__TMASS_V830_DESTROY__;
    } catch (_) {}
  }

  async function init() {
    if (Runtime.initialized || Runtime.destroyed) return;
    Runtime.initialized = true;

    registerMenu();
    await waitForBody();
    if (Runtime.destroyed) return;

    Highlighter.ensureStyle();

    try {
      PanelView.init(NavigationController);
      observeDomMutations();
      installSpaHooks();
    } catch (err) {
      console.error(`tmass v${Config.version} init failed:`, err);
    }
  }

  addManagedEventListener(window, 'pagehide', () => {
    NavigationController.stop('');
  });

  addManagedEventListener(window, 'beforeunload', () => {
    NavigationController.stop('');
  });

  window[APP_KEY] = {
    initialized: true,
    version: Config.version,
    destroy
  };
  window.__TMASS_V830_DESTROY__ = destroy;

  init();
})();