/**
 * Shairee — Tauri API wrapper
 * Typed invoke() calls and event listeners for Rust backend communication
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

// ─── Types ───────────────────────────────────────────────────────────

export interface SharedFileInfo {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  isDirectory: boolean;
}

export interface ServerStatus {
  serverRunning: boolean;
  port: number;
  accessUrl: string;
  activeConnections: number;
  localIps: string[];
}

export interface TransferRecord {
  fileName: string;
  clientIp: string;
  bytesTransferred: number;
  totalBytes: number;
  speedBps: number;
  status: string;
  timestamp: string;
}

export interface AppConfig {
  port: number;
  password: string;
  autoStart: boolean;
  showNotifications: boolean;
  [key: string]: unknown;
}

// ─── Event Payloads ──────────────────────────────────────────────────

export interface ServerStartedPayload {
  url: string;
}

export interface TransferProgressPayload {
  fileId: string;
  fileName: string;
  clientIp: string;
  bytesTransferred: number;
  totalBytes: number;
  speedBps: number;
}

export interface TransferCompletePayload {
  fileId: string;
  fileName: string;
  clientIp: string;
}

export interface ClientPayload {
  ip: string;
}

// ─── Server Commands ─────────────────────────────────────────────────

export async function getServerStatus(): Promise<ServerStatus> {
  return invoke<ServerStatus>('get_server_status');
}

export async function startServer(): Promise<string> {
  return invoke<string>('start_server');
}

export async function stopServer(): Promise<void> {
  return invoke<void>('stop_server');
}

// ─── File Commands ───────────────────────────────────────────────────

export async function addFiles(paths: string[]): Promise<SharedFileInfo[]> {
  return invoke<SharedFileInfo[]>('add_files', { paths });
}

export async function addFolder(path: string): Promise<SharedFileInfo[]> {
  return invoke<SharedFileInfo[]>('add_folder', { path });
}

export async function removeFile(id: string): Promise<void> {
  return invoke<void>('remove_file', { id });
}

export async function clearFiles(): Promise<void> {
  return invoke<void>('clear_files');
}

export async function getSharedFiles(): Promise<SharedFileInfo[]> {
  return invoke<SharedFileInfo[]>('get_shared_files');
}

// ─── QR & Info ───────────────────────────────────────────────────────

export async function getQrCode(): Promise<string> {
  return invoke<string>('get_qr_code');
}

export async function getTransferLog(): Promise<TransferRecord[]> {
  return invoke<TransferRecord[]>('get_transfer_log');
}

export async function getLocalIps(): Promise<string[]> {
  return invoke<string[]>('get_local_ips');
}

// ─── Config ──────────────────────────────────────────────────────────

export async function getConfig(): Promise<AppConfig> {
  return invoke<AppConfig>('get_config');
}

export async function updateConfig(config: AppConfig): Promise<void> {
  return invoke<void>('update_config', { config });
}

// ─── Event Listeners ─────────────────────────────────────────────────

export function onServerStarted(callback: (payload: ServerStartedPayload) => void): Promise<UnlistenFn> {
  return listen<ServerStartedPayload>('server-started', (event) => callback(event.payload));
}

export function onServerStopped(callback: () => void): Promise<UnlistenFn> {
  return listen('server-stopped', () => callback());
}

export function onTransferProgress(callback: (payload: TransferProgressPayload) => void): Promise<UnlistenFn> {
  return listen<TransferProgressPayload>('transfer-progress', (event) => callback(event.payload));
}

export function onTransferComplete(callback: (payload: TransferCompletePayload) => void): Promise<UnlistenFn> {
  return listen<TransferCompletePayload>('transfer-complete', (event) => callback(event.payload));
}

export function onClientConnected(callback: (payload: ClientPayload) => void): Promise<UnlistenFn> {
  return listen<ClientPayload>('client-connected', (event) => callback(event.payload));
}

export function onClientDisconnected(callback: (payload: ClientPayload) => void): Promise<UnlistenFn> {
  return listen<ClientPayload>('client-disconnected', (event) => callback(event.payload));
}

export function onFilesChanged(callback: () => void): Promise<UnlistenFn> {
  return listen('files-changed', () => callback());
}
