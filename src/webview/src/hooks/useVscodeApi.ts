import { useCallback, useEffect, useRef } from 'react';
import type { Message, Response } from '../types';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscodeApi = typeof acquireVsCodeApi !== 'undefined' ? acquireVsCodeApi() : null;

type MessageHandler = (response: Response) => void;

const pendingRequests = new Map<string, MessageHandler>();

let listenerRegistered = false;

function ensureListener() {
  if (listenerRegistered) return;
  listenerRegistered = true;

  window.addEventListener('message', (event: MessageEvent) => {
    const response = event.data as Response;

    if (response.id && pendingRequests.has(response.id)) {
      const handler = pendingRequests.get(response.id)!;
      pendingRequests.delete(response.id);
      handler(response);
    }
  });
}

const DEFAULT_TIMEOUT = 30000;

export function useVscodeApi() {
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      ensureListener();
    }
  }, []);

  const postMessage = useCallback(<T>(message: Message, options?: { timeout?: number }): Promise<Response<T>> => {
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT;

    return new Promise((resolve) => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        pendingRequests.delete(message.id);
      };

      pendingRequests.set(message.id, (response) => {
        cleanup();
        resolve(response as Response<T>);
      });

      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          if (pendingRequests.has(message.id)) {
            cleanup();
            resolve({
              id: message.id,
              success: false,
              error: `Request timed out after ${timeout}ms`,
            } as Response<T>);
          }
        }, timeout);
      }

      if (vscodeApi) {
        vscodeApi.postMessage(message);
      } else {
        console.log('VS Code API not available. Message:', message);
        setTimeout(() => {
          if (pendingRequests.has(message.id)) {
            cleanup();
            resolve({
              id: message.id,
              success: false,
              error: 'VS Code API not available (development mode)',
            } as Response<T>);
          }
        }, 100);
      }
    });
  }, []);

  const getState = useCallback(() => {
    return vscodeApi?.getState();
  }, []);

  const setState = useCallback((state: unknown) => {
    vscodeApi?.setState(state);
  }, []);

  return { postMessage, getState, setState };
}
