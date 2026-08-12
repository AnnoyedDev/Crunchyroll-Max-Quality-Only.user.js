// ==UserScript==
// @name         Crunchyroll - Max quality only
// @namespace    https://www.crunchyroll.com/
// @version      1.0
// @author       AnnoyedDev
// @description  Max quality only
// @match        https://www.crunchyroll.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  let lastResolution = null;

  function isManifestUrl(url) {
    if (!url) return false;
    try {
      const u = new URL(url, location.href);
      return u.pathname.includes('/manifest/') && u.pathname.endsWith('manifest.mpd');
    } catch (e) {
      return typeof url === 'string' && url.includes('manifest.mpd');
    }
  }

  function filterMpd(text) {
    try {
      const parser = new DOMParser();
      const xml = parser.parseFromString(text, 'application/xml');

      if (xml.querySelector('parsererror')) {
        console.warn('[CR Max Quality] Manifest parse error, sending original.');
        return text;
      }

      const adaptationSets = Array.from(xml.getElementsByTagName('AdaptationSet'));
      let chosenWidth = null;
      let chosenHeight = null;
      let videoAdaptationSets = 0;
      let removedRepresentations = 0;
      let keptRepresentations = 0;

      adaptationSets.forEach((as) => {
        const mimeType = as.getAttribute('mimeType') || '';
        const contentType = as.getAttribute('contentType') || '';
        const representations = Array.from(as.getElementsByTagName('Representation'));

        const isVideo =
          contentType === 'video' ||
          mimeType.includes('video') ||
          representations.some((r) => r.hasAttribute('width'));

        if (!isVideo || representations.length === 0) return;

        videoAdaptationSets += 1;

        let maxWidth = -1;
        representations.forEach((r) => {
          const width = parseInt(r.getAttribute('width') || '0', 10);
          if (width > maxWidth) maxWidth = width;
        });

        representations.forEach((r) => {
          const width = parseInt(r.getAttribute('width') || '0', 10);
          if (width !== maxWidth) {
            r.parentNode.removeChild(r);
            removedRepresentations += 1;
          } else {
            keptRepresentations += 1;
            if (chosenWidth === null || width > chosenWidth) {
              chosenWidth = width;
              chosenHeight = parseInt(r.getAttribute('height') || '0', 10);
            }
          }
        });
      });

      if (chosenWidth) {
        lastResolution = `${chosenWidth}x${chosenHeight}`;
        window.__crMaxResolution = lastResolution;
        document.dispatchEvent(
          new CustomEvent('cr-mpd-filtered', { detail: { resolution: lastResolution } })
        );
      }

      console.log(
        `[CR Max Quality] Filtered manifest: ${videoAdaptationSets} video adaptation set(s), kept ${keptRepresentations} representation(s), removed ${removedRepresentations}, resolution=${lastResolution}`
      );

      return new XMLSerializer().serializeToString(xml);
    } catch (e) {
      console.error('[CR Max Quality] Manifest filtering failed', e);
      return text;
    }
  }

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const input = args[0];
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const response = await originalFetch.apply(this, args);

    if (!isManifestUrl(url)) return response;

    const text = await response.clone().text();
    const filtered = filterMpd(text);

    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');

    return new Response(filtered, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };

  const XHR = window.XMLHttpRequest;
  const openOriginal = XHR.prototype.open;
  const sendOriginal = XHR.prototype.send;

  XHR.prototype.open = function (method, url, ...rest) {
    this.__crUrl = url;
    return openOriginal.call(this, method, url, ...rest);
  };

  XHR.prototype.send = function (...args) {
    if (isManifestUrl(this.__crUrl)) {
      this.addEventListener('readystatechange', function () {
        if (this.readyState !== 4 || this.__crFiltered) return;
        this.__crFiltered = true;

        try {
          if (this.responseType === '' || this.responseType === 'text') {
            const filtered = filterMpd(this.responseText);
            Object.defineProperty(this, 'responseText', { value: filtered, configurable: true });
            Object.defineProperty(this, 'response', { value: filtered, configurable: true });
          } else if (this.responseType === 'arraybuffer') {
            const original = new TextDecoder('utf-8').decode(this.response);
            const filtered = filterMpd(original);
            const buffer = new TextEncoder().encode(filtered).buffer;
            Object.defineProperty(this, 'response', { value: buffer, configurable: true });
          } else if (this.responseType === 'document') {
            const filtered = filterMpd(new XMLSerializer().serializeToString(this.responseXML));
            const doc = new DOMParser().parseFromString(filtered, 'application/xml');
            Object.defineProperty(this, 'responseXML', { value: doc, configurable: true });
            Object.defineProperty(this, 'response', { value: doc, configurable: true });
          }
        } catch (e) {
          console.error('[CR Max Quality] XHR filtering failed', e);
        }
      });
    }
    return sendOriginal.apply(this, args);
  };

  function replaceQualityMenu(el) {
    if (el.__crReplaced) return;

    const label = el.getAttribute('aria-label') || el.getAttribute('label');
    if (label !== 'Qualité') return;

    el.__crReplaced = true;
    const resolution = window.__crMaxResolution || lastResolution || '';
    const message = resolution
      ? `Max quality only avaible.(${resolution})`
      : 'Max quality only avaible.';

    el.innerHTML = '';
    const p = document.createElement('div');
    p.textContent = message;
    p.style.padding = '8px 12px';
    el.appendChild(p);
  }

  function scanForQualityMenus(root) {
    if (!(root instanceof Element)) return;
    if (root.matches?.('div[role="menu"]')) replaceQualityMenu(root);
    root.querySelectorAll?.('div[role="menu"]').forEach(replaceQualityMenu);
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => scanForQualityMenus(node));
    }
  });

  function startObserving() {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.body) {
    startObserving();
  } else {
    document.addEventListener('DOMContentLoaded', startObserving);
  }
})();
