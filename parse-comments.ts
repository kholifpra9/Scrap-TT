import { chromium } from 'patchright';
import fs from 'fs';
import path from 'path';
import os from 'os';

const searchQuery = process.argv[2] ? decodeURIComponent(process.argv[2]) : null;
if (!searchQuery) {
  console.error("Usage: npx tsx parse-comments.ts searchQuery [maxVideos] [maxCommentsPerVideo]");
  process.exit(1);
}
const maxVideos = process.argv[3] ? parseInt(process.argv[3]) : 20;
const maxCommentsPerVideo = process.argv[4] ? parseInt(process.argv[4]) : 500;

// Buat folder output dengan nama keyword + timestamp
// OUTPUT_DIR di-set oleh server.js → result/, fallback ke direktori script
const scriptDir = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1');
const outputDir = process.env.OUTPUT_DIR || scriptDir;
const safeQuery = searchQuery.replace(/[^a-zA-Z0-9]/g, '_');
const folderName = `scrape_${safeQuery}_${Date.now()}`;
const outputFolder = path.join(outputDir, folderName);
fs.mkdirSync(outputFolder, { recursive: true });

const videosCsvFile = path.join(outputFolder, `videos.csv`);
const commentsCsvFile = path.join(outputFolder, `comments.csv`);

fs.writeFileSync(videosCsvFile, 'videoId,username,nickname,views,likes,comments,shares,saves,description,hashtags,videoUrl,scrapeDate\n');
fs.writeFileSync(commentsCsvFile, 'commentId,videoId,videoUrl,commenterUsername,commenterNickname,commenterUid,commentText,likes,replyCount,commentDate,scrapeDate\n');

console.log(`📂 Output folder: ${outputFolder}`);
console.log(`📁 Videos  : videos.csv`);
console.log(`📁 Comments: comments.csv`);

function isValidComment(text: string): boolean {
  if (!text || !text.trim()) return false;

  let clean = text
    .replace(/\[(?:sticker|emoji):[^\]]*\]/gi, '')
    .replace(/@\S+/g, '')
    .replace(/\p{Emoji}/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .trim();

  return clean.length >= 3;
}

let browser: any = null;

process.on('SIGINT', async () => {
  console.log('\n⚠️ Interrupted, closing browser...');
  if (browser) await browser.close();
  process.exit(0);
});

(async () => {
  try {
    console.log('🚀 Starting TikTok Comment Scraper...\n');

    const sessionDir = path.join(os.tmpdir(), 'patchright_tiktok');
    browser = await chromium.launchPersistentContext(sessionDir, {
      channel: 'chrome',
      headless: false,
      viewport: { width: 1280, height: 800 },
    });

    const page = await browser.newPage();

    // ── STEP 1: Kumpulkan video dari search ───────────────────────────
    console.log(`[STEP 1] Searching "${searchQuery}"...\n`);

    let allVideos: any[] = [];

    page.on('response', async (response: any) => {
      if (response.url().includes('/api/search/item/full/')) {
        try {
          const data = await response.json();
          if (data.item_list?.length) {
            allVideos.push(...data.item_list);
            console.log(`📦 ${allVideos.length} videos found`);
          }
        } catch { }
      }
    });

    await page.goto(`https://www.tiktok.com/search/video?q=${encodeURIComponent(searchQuery)}`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await page.waitForTimeout(4000);

    let scrollCount = 0;
    let noNewVideos = 0;
    while (allVideos.length < maxVideos && scrollCount < 50) {
      const prev = allVideos.length;
      console.log(`🔄 Scroll #${scrollCount + 1} - ${allVideos.length}/${maxVideos}`);
      const scrolled = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('[id^="grid-item-container-"]'));
        if (!items.length) return false;
        (items[items.length - 1] as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'end' });
        return true;
      });
      if (!scrolled) await page.evaluate(() => window.scrollBy(0, 800));
      await page.waitForTimeout(2500);
      scrollCount++;
      if (allVideos.length === prev) {
        noNewVideos++;
        if (noNewVideos >= 5) { console.log('⚠️ No new videos.'); break; }
      } else {
        noNewVideos = 0;
      }
    }

    const videos = Array.from(new Map(allVideos.map((v: any) => [v.id, v])).values()).slice(0, maxVideos);

    if (!videos.length) {
      console.error('❌ No videos found.');
      await browser.close();
      process.exit(1);
    }

    console.log(`\n✅ ${videos.length} videos found. Saving...\n`);
    const scrapeDate = new Date().toISOString();

    videos.forEach((v: any) => {
      const username = v.author?.uniqueId || 'N/A';
      const nickname = (v.author?.nickname || 'N/A').replace(/,/g, ' ');
      const desc = (v.desc || 'N/A').replace(/,/g, ' ');
      const stats = v.stats || v.statsV2 || {};
      const hashtags = v.challenges?.map((c: any) => c.title).join(' ') ||
        v.textExtra?.filter((t: any) => t.hashtagName).map((t: any) => t.hashtagName).join(' ') || 'N/A';
      const videoUrl = `https://www.tiktok.com/@${username}/video/${v.id}`;
      const row = [
        v.id, username, nickname,
        stats.playCount || 0, stats.diggCount || 0, stats.commentCount || 0,
        stats.shareCount || 0, stats.collectCount || 0,
        desc, hashtags, videoUrl, scrapeDate
      ].map((val: any) => `"${val.toString().replace(/"/g, '""')}"`).join(',');
      fs.appendFileSync(videosCsvFile, row + '\n');
    });

    console.log(`✅ Videos saved.\n`);

    // ── STEP 2: Ambil komentar via API langsung ────────────────────────
    console.log(`[STEP 2] Scraping comments (max ${maxCommentsPerVideo}/video)...\n`);

    let totalComments = 0;

    for (let i = 0; i < videos.length; i++) {
      const v = videos[i];
      const username = v.author?.uniqueId || 'N/A';
      const videoId = v.id;
      const videoUrl = `https://www.tiktok.com/@${username}/video/${videoId}`;

      console.log(`\n[${i + 1}/${videos.length}] @${username} — ${videoId}`);

      // Buka halaman video supaya cookies/token ter-set
      const currentUrl = page.url();
      if (!currentUrl.includes(videoId)) {
        // Klik dari grid kalau ada
        const clicked = await page.evaluate((vid: string) => {
          const links = Array.from(document.querySelectorAll(`a[href*="${vid}"]`));
          if (links.length > 0) { (links[0] as HTMLElement).click(); return true; }
          return false;
        }, videoId);

        if (!clicked) {
          await page.goto(videoUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        }
        await page.waitForTimeout(4000);
      }

      // Ambil cookies + params dari halaman untuk hit API comment langsung
      const commentMap = new Map<string, any>();

      // Intercept response dulu dari initial load
      const firstLoad = new Promise<void>((resolve) => {
        const handler = async (response: any) => {
          if (response.url().includes('/api/comment/list/')) {
            try {
              const data = await response.json();
              if (data.comments?.length) {
                data.comments.forEach((c: any) => commentMap.set(c.cid, c));
                console.log(`  💬 ${commentMap.size} comments captured`);
              }
            } catch { }
            page.off('response', handler);
            resolve();
          }
        };
        page.on('response', handler);
        setTimeout(() => { page.off('response', handler); resolve(); }, 8000);
      });

      await firstLoad;

      // Sekarang lanjut pagination via scroll — intercept semua response berikutnya
      const commentHandler = async (response: any) => {
        if (response.url().includes('/api/comment/list/')) {
          try {
            const data = await response.json();
            if (data.comments?.length) {
              data.comments.forEach((c: any) => commentMap.set(c.cid, c));
              console.log(`  💬 ${commentMap.size} comments captured`);
            }
          } catch { }
        }
      };
      page.on('response', commentHandler);

      // Scroll panel komentar sampai habis
      let noNew = 0;
      let tries = 0;

      while (commentMap.size < maxCommentsPerVideo && tries < 300) {
        const prevSize = commentMap.size;
        tries++;

        // Scroll panel komentar dengan berbagai cara
        await page.evaluate(() => {
          // Selector panel komentar TikTok
          const selectors = [
            '[data-e2e="comment-list"]',
            '[class*="DivCommentListContainer"]',
            '[class*="CommentListContainer"]',
            '[class*="comment-list"]',
            '[class*="CommentList"]',
          ];

          let panel: Element | null = null;
          for (const sel of selectors) {
            panel = document.querySelector(sel);
            if (panel) break;
          }

          if (panel) {
            const p = panel as HTMLElement;
            // Scroll ke bawah
            p.scrollTop = p.scrollHeight;
            // Wheel event
            p.dispatchEvent(new WheelEvent('wheel', { deltaY: 1000, bubbles: true, cancelable: true }));
            // Scroll anak terakhir ke view
            const children = p.children;
            if (children.length > 0) {
              (children[children.length - 1] as HTMLElement).scrollIntoView({ block: 'end', behavior: 'instant' });
            }
          }
        });

        await page.waitForTimeout(1500);

        if (commentMap.size === prevSize) {
          noNew++;

          if (noNew === 3) {
            // Coba tekan End key
            await page.keyboard.press('End');
            await page.waitForTimeout(1000);
          }

          if (noNew === 5) {
            // Coba Tab ke elemen komentar
            await page.keyboard.press('Tab');
            await page.keyboard.press('End');
            await page.waitForTimeout(1500);
          }

          if (noNew >= 10) {
            console.log(`  ⚠️ No more comments after ${tries} tries. Total: ${commentMap.size}`);
            break;
          }
        } else {
          noNew = 0;
        }
      }

      page.off('response', commentHandler);

      // Simpan komentar
      const finalComments = Array.from(commentMap.values())
        .filter((c: any) => isValidComment(c.text || ''))
        .slice(0, maxCommentsPerVideo);
      console.log(`  ✅ ${finalComments.length} comments saved`);
      totalComments += finalComments.length;

      finalComments.forEach((c: any) => {
        const commentDate = new Date(c.create_time * 1000).toISOString();
        const commenterUsername = c.user?.unique_id || 'N/A';
        const commenterNickname = (c.user?.nickname || 'N/A').replace(/,/g, ' ');
        const commenterUid = c.user?.uid || 'N/A';
        const text = (c.text || '').replace(/,/g, ' ').replace(/\n/g, ' ');
        const row = [
          c.cid, videoId, videoUrl,
          commenterUsername, commenterNickname, commenterUid,
          text, c.digg_count || 0, c.reply_comment_total || 0,
          commentDate, scrapeDate
        ].map((val: any) => `"${val.toString().replace(/"/g, '""')}"`).join(',');
        fs.appendFileSync(commentsCsvFile, row + '\n');
      });

      // Kembali ke search untuk video berikutnya
      if (i < videos.length - 1) {
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(async () => {
          await page.goto(`https://www.tiktok.com/search/video?q=${encodeURIComponent(searchQuery)}`, {
            waitUntil: 'domcontentloaded', timeout: 30000
          });
        });
        await page.waitForTimeout(2500);
      }
    }

    console.log(`\n✅ DONE!`);
    console.log(`   📂 Folder  : ${outputFolder}`);
    console.log(`   📹 Videos  : ${videos.length} → videos.csv`);
    console.log(`   💬 Comments: ${totalComments} → comments.csv`);

    await browser.close();
  } catch (error: any) {
    console.error('❌ ERROR:', error.message);
    if (browser) await browser.close();
    process.exit(1);
  }
})();