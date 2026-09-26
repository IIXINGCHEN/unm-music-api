export interface SongDetail {
  id: string;
  name: string;
  artist: string;
  album: string;
  picUrl: string;
  duration: number;
}

export interface MatchedAudio {
  id: string;
  url: string;
  /** 码率，单位 bps（如 320000 = 320kbps），与 @unblockneteasemusic/server 0.28.0 对齐 */
  br: number;
  size: number;
  source: string;
  md5: string | null;
  proxyUrl: string;
  title: string;
  artist: string;
  album: string;
  pic: string;
}

export interface NcmAudioResult {
  id: string;
  /** 码率，单位 bps */
  br: number;
  url: string;
  size: number;
  source: string;
  proxyUrl: string;
}

export interface GDTrack {
  id: string;
  name: string;
  artist: string[];
  album: string;
  pic_id: string;
  url_id: string;
  lyric_id: string;
  source: string;
  from?: string;
  /** 上游 search 直接透出的扩展元数据（has_hires / duration 秒 / isrc） */
  extra_data?: {
    has_hires?: boolean;
    duration?: number;
    isrc?: string;
  };
}

/** 上游 url 返回的 br 负值语义：-1 获取失败 / -2 无版权 / -3 试听版 */
export type GDUrlStatus = "ok" | "unavailable" | "no_copyright" | "trial";

export interface GDUrlResponse {
  url: string;
  /** 码率，单位 bps（上游返回 kbps，getUrl 内已换算；负值时按 status 语义处理） */
  br: number;
  size: number;
  from?: string;
  source?: string;
  /** 链接可用性状态，由上游 br 负值映射而来 */
  status: GDUrlStatus;
}

export interface GDPicResponse {
  url: string;
  from?: string;
}

export interface GDLyricResponse {
  lyric: string;
  tlyric?: string;
  from?: string;
}

export interface LyricResult {
  lyric: string;
  tlyric: string;
}

export interface PlaylistTrack {
  id: string;
  name: string;
  artist: string;
  album: string;
  picUrl: string;
  duration: number;
}

export interface PlaylistDetail {
  id: string;
  name: string;
  coverImgUrl: string;
  description: string;
  creator: string;
  trackCount: number;
  tracks: PlaylistTrack[];
  songIds: string[];
  /** 部分加载：元数据缺失的曲目数（全部成功时为 undefined） */
  partialLoaded?: number;
}
