'use strict';
// 알림 보내기: ntfy / telegram / kakao (NOTIFY_CHANNEL에 쉼표로 여러 개 지정 가능)
const kakao = require('./kakao');

async function sendNtfy(cfg, title, message, url, links = []) {
  if (!cfg.ntfyTopic) throw new Error('ntfy 토픽이 없어요');
  const body = { topic: cfg.ntfyTopic, title, message, tags: ['red_car'], priority: 4 };
  const actions = [];
  if (url) {
    body.click = url;
    actions.push({ action: 'view', label: '지도 보기', url });
  }
  for (const l of links) actions.push({ action: 'view', label: l.label, url: l.url });
  if (actions.length) body.actions = actions.slice(0, 3);
  const res = await fetch(cfg.ntfyServer + '/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`ntfy 오류 (${res.status}): ${await res.text()}`);
}

async function sendTelegram(cfg, title, message, url, links = []) {
  if (!cfg.telegramToken || !cfg.telegramChatId) throw new Error('텔레그램 봇 토큰/채팅 ID가 없어요');
  const text = `${title}\n${message}${url ? `\n${url}` : ''}${links.map((l) => `\n${l.label}: ${l.url}`).join('')}`;
  const res = await fetch(`https://api.telegram.org/bot${cfg.telegramToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: cfg.telegramChatId, text, disable_web_page_preview: true }),
  });
  if (!res.ok) throw new Error(`텔레그램 오류 (${res.status}): ${await res.text()}`);
}

async function sendKakao(cfg, title, message, url) {
  await kakao.sendMemo(cfg, `${title}\n${message}`, url);
}

const senders = { ntfy: sendNtfy, telegram: sendTelegram, kakao: sendKakao };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 일시적인 네트워크 오류에 대비해 최대 5번까지 다시 시도
async function withRetry(fn, label) {
  const waits = [0, 5000, 15000, 30000, 60000];
  let last;
  for (let i = 0; i < waits.length; i++) {
    if (waits[i]) await sleep(waits[i]);
    try {
      return await fn();
    } catch (e) {
      last = e;
      console.error(`[알림 재시도 ${i + 1}/${waits.length}:${label}]`, e?.cause?.code || e.message);
    }
  }
  throw last;
}

async function notify(cfg, title, message, url, links = []) {
  const results = await Promise.allSettled(
    cfg.channels.map((ch) => {
      const fn = senders[ch];
      if (!fn) return Promise.reject(new Error(`알 수 없는 알림 채널: ${ch}`));
      return withRetry(() => fn(cfg, title, message, url, links), ch);
    })
  );
  results.forEach((r, i) => {
    if (r.status === 'rejected') console.error(`[알림 최종 실패:${cfg.channels[i]}]`, r.reason?.message || r.reason);
    else console.log(`[알림 전송:${cfg.channels[i]}] ${title}`);
  });
  return results.some((r) => r.status === 'fulfilled');
}

module.exports = { notify, sendNtfy, sendTelegram, sendKakao };
