import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractYouTubeVideoId, parseStoreVideoUrl } from './tvDisplay';
import { formatHardwareConnectionError } from '../services/thermalPrinterService';

describe('tvDisplay video source parser', () => {
  it('detects standard YouTube, youtu.be, and Shorts URLs and generates embed URLs', () => {
    assert.equal(extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.equal(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    assert.equal(extractYouTubeVideoId('https://youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');

    const parsed = parseStoreVideoUrl('https://youtu.be/dQw4w9WgXcQ');
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.source_type, 'youtube');
      assert.ok(parsed.embed_url?.includes('youtube.com/embed/dQw4w9WgXcQ'));
    }
  });

  it('accepts direct MP4/WebM HTTPS URLs and local blob uploads, while rejecting unsafe schemes', () => {
    const mp4 = parseStoreVideoUrl('https://cdn.brewflow.id/videos/promo.mp4');
    assert.equal(mp4.ok, true);
    if (mp4.ok) assert.equal(mp4.source_type, 'mp4');

    const blob = parseStoreVideoUrl('blob:https://brewflow.id/123456');
    assert.equal(blob.ok, true);
    if (blob.ok) assert.equal(blob.source_type, 'upload');

    const unsafe = parseStoreVideoUrl('javascript:alert(1)');
    assert.equal(unsafe.ok, false);
  });
});

describe('thermalPrinterService hardware error formatting', () => {
  it('translates Chrome Permissions-Policy Failed to execute errors into clear Indonesian guidance', () => {
    const securityErr = new Error(
      "Failed to execute 'requestDevice' on 'Bluetooth': Access to the feature \"bluetooth\" is disallowed by permissions policy."
    );
    securityErr.name = 'SecurityError';
    const msg = formatHardwareConnectionError(securityErr, 'bluetooth');
    assert.match(msg, /Permissions-Policy/i);
    assert.match(msg, /tab penuh Chrome\/Edge/i);
    assert.match(msg, /Driver OS/i);
  });
});
