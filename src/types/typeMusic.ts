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
}

export interface GDUrlResponse {
  url: string;
  br: number;
  size: number;
  from?: string;
  source?: string;
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
  /**
   * 部分曲目元数据拉取失败时，缺失的真实曲目数量。
   * undefined 表示 tracks 已完整加载。消费端据此向用户提示降级，
   * 而非依赖被伪造的占位条目。
   */
  partialLoaded?: number;
}
