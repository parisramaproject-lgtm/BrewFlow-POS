import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Coffee,
  Eye,
  EyeOff,
  Film,
  Link2,
  Maximize2,
  Minimize2,
  MonitorPlay,
  Pause,
  Play,
  Plus,
  SkipBack,
  SkipForward,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import type { StoreVideoItem } from '../types';
import { getPromoStatus } from '../utils/membershipProgram';
import { parseStoreVideoUrl } from '../utils/tvDisplay';

export function TVDisplayPage() {
  const { user } = useAuth();
  const {
    storeVideos,
    settings,
    membershipProgram,
    addStoreVideo,
    deleteStoreVideo,
    toggleStoreVideo,
    moveStoreVideo,
  } = useStore();

  const activePlaylist = useMemo(
    () => storeVideos.filter((v) => v.is_active),
    [storeVideos]
  );

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [isFullscreenMode, setIsFullscreenMode] = useState(false);
  const [videoPlaybackError, setVideoPlaybackError] = useState(false);

  // Add video form state
  const [inputMode, setInputMode] = useState<'url' | 'upload'>('url');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [showPromoTicker, setShowPromoTicker] = useState(true);
  const [uploadedFileUrl, setUploadedFileUrl] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageContainerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const safeIndex = activePlaylist.length > 0 ? currentIndex % activePlaylist.length : 0;
  const currentVideo: StoreVideoItem | null = activePlaylist[safeIndex] ?? null;

  const activePromosText = useMemo(() => {
    const items: string[] = [];
    if (membershipProgram.limits.new_member_promo_enabled) {
      items.push(membershipProgram.limits.new_member_promo_title);
    }
    for (const promo of membershipProgram.promos) {
      if (getPromoStatus(promo) === 'active') {
        items.push(`${promo.title} (s/d ${promo.end_date})`);
      }
    }
    return items.length > 0
      ? items.join('   •   ')
      : `${settings.shopName} — Nikmati kopi spesialti & daftar Membership untuk diskon hingga 15%!`;
  }, [membershipProgram, settings.shopName]);

  useEffect(() => {
    setVideoPlaybackError(false);
  }, [currentVideo?.id]);

  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !currentVideo || currentVideo.source_type === 'youtube') return;
    if (isPlaying) {
      const p = videoEl.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          // Autoplay might be blocked before interaction; keep UI responsive
        });
      }
    } else {
      videoEl.pause();
    }
  }, [isPlaying, currentVideo]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreenMode) {
        setIsFullscreenMode(false);
        if (document.fullscreenElement) {
          void document.exitFullscreen().catch(() => {});
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreenMode]);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4000);
  };

  const handleNext = () => {
    if (activePlaylist.length <= 1) return;
    setCurrentIndex((prev) => (prev + 1) % activePlaylist.length);
  };

  const handlePrev = () => {
    if (activePlaylist.length <= 1) return;
    setCurrentIndex((prev) => (prev - 1 + activePlaylist.length) % activePlaylist.length);
  };

  const enterFullscreen = () => {
    setIsFullscreenMode(true);
    const el = stageContainerRef.current ?? document.documentElement;
    if (el && typeof el.requestFullscreen === 'function') {
      void el.requestFullscreen().catch(() => {
        // Fallback: fixed full-viewport overlay already covers the entire window
      });
    }
  };

  const exitFullscreen = () => {
    setIsFullscreenMode(false);
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      setFormError('File harus berupa video (MP4, WebM, MOV, atau OGG).');
      return;
    }
    if (uploadedFileUrl) {
      URL.revokeObjectURL(uploadedFileUrl);
    }
    const objUrl = URL.createObjectURL(file);
    setUploadedFileUrl(objUrl);
    setUploadedFileName(file.name);
    if (!title.trim()) {
      setTitle(file.name.replace(/\.[^.]+$/, ''));
    }
    setFormError(null);
  };

  const handleAddVideo = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!title.trim()) {
      setFormError('Judul video wajib diisi.');
      return;
    }

    const rawSource = inputMode === 'upload' ? uploadedFileUrl ?? '' : videoUrl;
    if (inputMode === 'upload' && !uploadedFileUrl) {
      setFormError('Pilih file video dari perangkat Anda terlebih dahulu.');
      return;
    }

    const parsed = parseStoreVideoUrl(rawSource);
    if (!parsed.ok) {
      setFormError(parsed.reason);
      return;
    }

    const added = addStoreVideo({
      title: title.trim(),
      subtitle: subtitle.trim() || undefined,
      source_type: parsed.source_type,
      url: parsed.url,
      embed_url: parsed.embed_url,
      is_active: true,
      show_promo_ticker: showPromoTicker,
      created_by_name: user?.full_name ?? 'Staf BrewFlow',
    });

    setCurrentIndex(0);
    setTitle('');
    setSubtitle('');
    setVideoUrl('');
    setUploadedFileUrl(null);
    setUploadedFileName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    showToast(`Video "${added.title}" ditambahkan ke playlist Display TV Store.`);
  };

  const handlePlaySpecific = (video: StoreVideoItem) => {
    if (!video.is_active) {
      toggleStoreVideo(video.id);
      setCurrentIndex(0);
      setIsPlaying(true);
      return;
    }
    const idx = activePlaylist.findIndex((v) => v.id === video.id);
    if (idx >= 0) {
      setCurrentIndex(idx);
      setIsPlaying(true);
    }
  };

  const renderTVStage = (fullscreen: boolean) => (
    <div
      ref={fullscreen ? stageContainerRef : undefined}
      data-testid={fullscreen ? 'tv-fullscreen-overlay' : 'tv-preview-stage'}
      className={
        fullscreen
          ? 'fixed inset-0 z-[70] flex flex-col bg-[#0E1713] text-white'
          : 'relative overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#0E1713] text-white shadow-sm'
      }
    >
      {/* Top Branding Overlay */}
      <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-[#1A2E26]/90 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          {settings.shopLogoUrl ? (
            <img
              src={settings.shopLogoUrl}
              alt={settings.shopName}
              className="h-7 w-7 rounded-lg bg-white object-contain p-0.5"
            />
          ) : (
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#109A58] text-white">
              <Coffee className="h-4 w-4" />
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-xs font-bold tracking-wide text-white">
              {settings.shopName}
            </p>
            <p className="truncate text-[11px] text-[#A7F3D0]">
              {currentVideo ? currentVideo.title : 'Belum ada video aktif di playlist'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {activePlaylist.length > 0 && (
            <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold text-white/90 tabular-nums">
              {safeIndex + 1} / {activePlaylist.length}
            </span>
          )}
          {fullscreen ? (
            <button
              type="button"
              onClick={exitFullscreen}
              data-testid="tv-exit-fullscreen"
              className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/25"
            >
              <Minimize2 className="h-3.5 w-3.5" />
              <span>Keluar TV</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={enterFullscreen}
              data-testid="tv-enter-fullscreen"
              className="inline-flex items-center gap-1.5 rounded-full bg-[#109A58] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0D8A4E]"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              <span>Mode Layar Penuh TV</span>
            </button>
          )}
        </div>
      </div>

      {/* Main 16:9 Video Canvas */}
      <div
        className={`relative flex items-center justify-center overflow-hidden bg-black ${
          fullscreen ? 'min-h-0 flex-1' : 'aspect-video w-full'
        }`}
      >
        {!currentVideo ? (
          <div className="flex flex-col items-center justify-center px-6 text-center">
            <MonitorPlay className="h-12 w-12 text-[#109A58]/70" />
            <p className="mt-3 text-sm font-semibold text-white">
              Belum Ada Video Aktif untuk Ditampilkan
            </p>
            <p className="mt-1 max-w-sm text-xs text-white/65">
              Tambahkan video promosi, menu highlight, atau ambience coffee shop melalui form
              playlist di samping.
            </p>
          </div>
        ) : currentVideo.source_type === 'youtube' && currentVideo.embed_url ? (
          <iframe
            key={currentVideo.id}
            src={currentVideo.embed_url}
            title={currentVideo.title}
            allow="autoplay; encrypted-media; fullscreen"
            allowFullScreen
            className="h-full w-full border-0"
          />
        ) : videoPlaybackError ? (
          <div className="flex flex-col items-center justify-center px-6 text-center">
            <Film className="h-10 w-10 text-[#109A58]" />
            <p className="mt-2.5 text-sm font-semibold text-white">{currentVideo.title}</p>
            {currentVideo.subtitle && (
              <p className="mt-1 text-xs text-[#A7F3D0]">{currentVideo.subtitle}</p>
            )}
            <p className="mt-2 max-w-md text-[11px] text-white/60">
              Sumber video eksternal tidak dapat dimuat pada koneksi saat ini. Anda dapat mengunggah
              file video lokal (.mp4/.webm) agar selalu lancar diputar di TV store.
            </p>
          </div>
        ) : (
          <video
            key={currentVideo.id}
            ref={videoRef}
            src={currentVideo.url}
            autoPlay={isPlaying}
            muted={isMuted}
            loop={activePlaylist.length === 1}
            playsInline
            onEnded={handleNext}
            onError={() => setVideoPlaybackError(true)}
            className="h-full w-full object-contain"
          />
        )}

        {/* Subtitle Overlay Badge */}
        {currentVideo?.subtitle && (
          <div className="pointer-events-none absolute bottom-4 left-4 right-4 flex justify-center">
            <div className="rounded-full bg-[#1A2E26]/85 px-4 py-1.5 text-center text-xs font-medium text-white backdrop-blur-sm">
              {currentVideo.subtitle}
            </div>
          </div>
        )}
      </div>

      {/* Promo Ticker & Controls Footer */}
      <div className="border-t border-white/10 bg-[#13221C] px-4 py-2.5">
        {currentVideo?.show_promo_ticker !== false && (
          <div className="mb-2 flex items-center gap-2 overflow-hidden rounded-lg bg-[#109A58]/20 px-3 py-1.5 text-xs text-[#E6F5EE]">
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#34D399]" />
            <p className="truncate font-medium">{activePromosText}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handlePrev}
              disabled={activePlaylist.length <= 1}
              aria-label="Video sebelumnya"
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/20 disabled:opacity-40"
            >
              <SkipBack className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setIsPlaying((prev) => !prev)}
              disabled={!currentVideo || currentVideo.source_type === 'youtube'}
              aria-label={isPlaying ? 'Jeda video' : 'Putar video'}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#109A58] text-white hover:bg-[#0D8A4E] disabled:opacity-40"
            >
              {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={activePlaylist.length <= 1}
              aria-label="Video berikutnya"
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/20 disabled:opacity-40"
            >
              <SkipForward className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setIsMuted((prev) => !prev)}
              aria-label={isMuted ? 'Aktifkan suara' : 'Bisukan suara'}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-white/10 px-2.5 text-[11px] font-medium text-white hover:bg-white/20"
            >
              {isMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
              <span>{isMuted ? 'Bisu' : 'Suara Aktif'}</span>
            </button>
          </div>

          <span className="text-[11px] text-white/60">
            Auto-rotate playlist · Tekan Esc untuk keluar layar penuh
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 lg:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[#1A2E26]">Display TV Store</h1>
          <p className="mt-0.5 text-sm text-[#6B7280]">
            Putar video promosi, highlight menu, dan suasana kedai di layar TV outlet. Dapat
            dikelola oleh semua pengguna (Owner, Manager, &amp; Kasir).
          </p>
        </div>

        <button
          type="button"
          onClick={enterFullscreen}
          disabled={activePlaylist.length === 0}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-[#109A58] px-5 text-xs font-semibold text-white transition-colors hover:bg-[#0D8A4E] disabled:opacity-40 whitespace-nowrap"
        >
          <Maximize2 className="h-4 w-4" />
          <span>Tampilkan ke Layar TV</span>
        </button>
      </div>

      {toast && (
        <div
          role="status"
          data-testid="tv-toast"
          className="flex items-center justify-between gap-3 rounded-xl border border-[#109A58]/30 bg-[#E6F5EE] px-4 py-3 text-xs font-semibold text-[#109A58]"
        >
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {toast}
          </span>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Tutup notifikasi"
            className="text-[#109A58] hover:text-[#0D8A4E]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Main 2-Column Layout: Live TV Preview + Add Video Form */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Live TV Preview Player */}
        <div className="space-y-4 lg:col-span-7">
          {renderTVStage(false)}

          {/* Playlist Management List */}
          <div className="overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF]">
            <div className="flex items-center justify-between border-b border-[#E5E7EB] px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-[#1A2E26]">
                  Daftar Putar Video TV ({storeVideos.length})
                </h2>
                <p className="text-[11px] text-[#6B7280]">
                  {activePlaylist.length} video aktif diputar berurutan di layar TV store.
                </p>
              </div>
            </div>

            {storeVideos.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Film className="h-8 w-8 text-[#6B7280]/50" />
                <p className="mt-2.5 text-sm font-semibold text-[#1A2E26]">Playlist TV kosong</p>
                <p className="mt-1 text-xs text-[#6B7280]">
                  Tambahkan video dari link MP4/YouTube atau unggah file lokal di panel kanan.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[#E5E7EB]">
                {storeVideos.map((video, idx) => {
                  const isCurrentlyPlaying = currentVideo?.id === video.id;
                  return (
                    <div
                      key={video.id}
                      data-testid={`tv-video-item-${video.id}`}
                      className={`flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 transition-colors ${
                        isCurrentlyPlaying ? 'bg-[#E6F5EE]/50' : 'hover:bg-[#F4F6F5]/60'
                      }`}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <button
                          type="button"
                          onClick={() => handlePlaySpecific(video)}
                          aria-label={`Putar ${video.title}`}
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors ${
                            isCurrentlyPlaying
                              ? 'bg-[#109A58] text-white'
                              : 'bg-[#F4F6F5] text-[#1A2E26] hover:bg-[#E6F5EE] hover:text-[#109A58]'
                          }`}
                        >
                          <Play className="h-4 w-4" />
                        </button>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="truncate text-xs font-semibold text-[#1A2E26]">
                              {video.title}
                            </p>
                            <span className="rounded-full bg-[#F4F6F5] px-2 py-0.5 text-[10px] font-semibold uppercase text-[#6B7280]">
                              {video.source_type === 'youtube'
                                ? 'YouTube'
                                : video.source_type === 'upload'
                                  ? 'File Lokal'
                                  : 'MP4 URL'}
                            </span>
                            {isCurrentlyPlaying && (
                              <span className="rounded-full bg-[#E6F5EE] px-2 py-0.5 text-[10px] font-semibold text-[#109A58]">
                                Sedang Tayang
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 truncate text-[11px] text-[#6B7280]">
                            {video.subtitle || video.url}
                          </p>
                          <p className="text-[10px] text-[#6B7280]">
                            Ditambahkan oleh {video.created_by_name}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveStoreVideo(video.id, 'up')}
                          disabled={idx === 0}
                          aria-label={`Pindah ${video.title} ke atas`}
                          className="rounded-lg p-1.5 text-[#6B7280] hover:bg-[#F4F6F5] hover:text-[#1A2E26] disabled:opacity-30"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveStoreVideo(video.id, 'down')}
                          disabled={idx === storeVideos.length - 1}
                          aria-label={`Pindah ${video.title} ke bawah`}
                          className="rounded-lg p-1.5 text-[#6B7280] hover:bg-[#F4F6F5] hover:text-[#1A2E26] disabled:opacity-30"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            toggleStoreVideo(video.id);
                            showToast(
                              `Video "${video.title}" ${video.is_active ? 'disembunyikan dari' : 'diaktifkan di'} TV Display.`
                            );
                          }}
                          aria-label={video.is_active ? 'Sembunyikan video' : 'Aktifkan video'}
                          className={`rounded-lg p-1.5 transition-colors ${
                            video.is_active
                              ? 'text-[#109A58] hover:bg-[#E6F5EE]'
                              : 'text-[#6B7280] hover:bg-[#F4F6F5]'
                          }`}
                        >
                          {video.is_active ? (
                            <Eye className="h-3.5 w-3.5" />
                          ) : (
                            <EyeOff className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          data-testid={`delete-video-${video.id}`}
                          onClick={() => {
                            deleteStoreVideo(video.id);
                            showToast(`Video "${video.title}" dihapus dari playlist TV.`);
                          }}
                          aria-label={`Hapus video ${video.title}`}
                          className="rounded-lg p-1.5 text-[#6B7280] transition-colors hover:bg-[#FEF2F2] hover:text-[#EF4444]"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right: Add New Video Form */}
        <div className="lg:col-span-5">
          <form
            onSubmit={handleAddVideo}
            className="sticky top-6 space-y-4 rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-5"
            noValidate
          >
            <div>
              <h2 className="text-base font-semibold text-[#1A2E26]">Tambah Video Display TV</h2>
              <p className="mt-0.5 text-xs text-[#6B7280]">
                Unggah file video langsung dari komputer/tablet atau tempel tautan YouTube / MP4.
              </p>
            </div>

            {/* Source Mode Toggle */}
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-[#E5E7EB] bg-[#F4F6F5] p-1">
              <button
                type="button"
                onClick={() => {
                  setInputMode('url');
                  setFormError(null);
                }}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors ${
                  inputMode === 'url'
                    ? 'bg-[#FFFFFF] text-[#109A58] shadow-xs'
                    : 'text-[#6B7280] hover:text-[#1A2E26]'
                }`}
              >
                <Link2 className="h-3.5 w-3.5" />
                <span>Link URL / YouTube</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setInputMode('upload');
                  setFormError(null);
                }}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors ${
                  inputMode === 'upload'
                    ? 'bg-[#FFFFFF] text-[#109A58] shadow-xs'
                    : 'text-[#6B7280] hover:text-[#1A2E26]'
                }`}
              >
                <Upload className="h-3.5 w-3.5" />
                <span>Upload File Video</span>
              </button>
            </div>

            {formError && (
              <p
                role="alert"
                className="rounded-xl border border-[#EF4444]/30 bg-[#FEF2F2] px-3.5 py-2.5 text-xs font-medium text-[#EF4444]"
              >
                {formError}
              </p>
            )}

            <div>
              <label htmlFor="tv-video-title" className="block text-xs font-semibold text-[#1A2E26]">
                Judul Video *
              </label>
              <input
                id="tv-video-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Misal: Promo Paket Kopi Pagi & Croissant"
                className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
              />
            </div>

            {inputMode === 'url' ? (
              <div key="tv-source-url">
                <label htmlFor="tv-video-url" className="block text-xs font-semibold text-[#1A2E26]">
                  URL Video (MP4 / WebM / YouTube) *
                </label>
                <input
                  key="tv-input-url"
                  id="tv-video-url"
                  type="url"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="https://youtube.com/watch?v=... atau https://.../promo.mp4"
                  className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-[#6B7280]">
                  Mendukung link YouTube biasa, YouTube Shorts, maupun tautan langsung file MP4.
                </p>
              </div>
            ) : (
              <div key="tv-source-upload">
                <label className="block text-xs font-semibold text-[#1A2E26]">
                  Pilih File Video Lokal (.mp4, .webm, .mov) *
                </label>
                <input
                  key="tv-input-file"
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  onChange={handleFileSelected}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-1.5 flex w-full flex-col items-center justify-center rounded-xl border border-dashed border-[#109A58]/50 bg-[#E6F5EE]/40 px-4 py-5 text-center transition-colors hover:bg-[#E6F5EE]/70"
                >
                  <Upload className="h-5 w-5 text-[#109A58]" />
                  <span className="mt-1.5 text-xs font-semibold text-[#109A58]">
                    {uploadedFileName || 'Klik untuk memilih file video'}
                  </span>
                  <span className="mt-0.5 text-[11px] text-[#6B7280]">
                    Diputar langsung di layar TV tanpa lag internet
                  </span>
                </button>
              </div>
            )}

            <div>
              <label
                htmlFor="tv-video-subtitle"
                className="block text-xs font-semibold text-[#1A2E26]"
              >
                Teks Banner / Subtitle di Layar TV (Opsional)
              </label>
              <input
                id="tv-video-subtitle"
                type="text"
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                placeholder="Misal: Beli 2 Kopi Susu Gula Aren Hemat 20% — Khusus Member"
                className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
              />
            </div>

            <label className="flex cursor-pointer items-center justify-between rounded-xl border border-[#E5E7EB] bg-[#F4F6F5]/60 px-3.5 py-2.5">
              <div>
                <p className="text-xs font-semibold text-[#1A2E26]">Tampilkan Promo Ticker</p>
                <p className="text-[11px] text-[#6B7280]">
                  Tarik info promo Membership aktif otomatis di bagian bawah TV
                </p>
              </div>
              <input
                type="checkbox"
                checked={showPromoTicker}
                onChange={(e) => setShowPromoTicker(e.target.checked)}
                className="h-4 w-4 accent-[#109A58]"
              />
            </label>

            <button
              type="submit"
              data-testid="tv-add-video-btn"
              className="flex h-10 w-full items-center justify-center gap-1.5 rounded-full bg-[#109A58] px-5 text-xs font-semibold text-white transition-colors hover:bg-[#0D8A4E]"
            >
              <Plus className="h-4 w-4" />
              <span>Tambah ke Playlist TV</span>
            </button>
          </form>
        </div>
      </div>

      {/* Fullscreen TV Overlay */}
      {isFullscreenMode && renderTVStage(true)}
    </div>
  );
}
