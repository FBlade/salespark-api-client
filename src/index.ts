// api-client.ts
// FBladePT 16-08-2025 @ SalesPark
// Generic HTTP client wrapper built on top of Axios.
// Guarantees consistent { status:boolean, data:any } responses (never throws).
// Adds: retries with backoff, cancellation, per-request timeout, upload/download helpers,
// optional hooks, and CRUD sugar via resource().
//
// IMPROVED VERSION - Fixed types, better error handling, validation, and consistency

import axios, { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import type { InternalAxiosRequestConfig, AxiosProgressEvent } from "axios";

/** --------------------------------------------------------------------
 * Retry / Backoff defaults
 * ------------------------------------------------------------------ */
interface RetryOptions {
  retries: number; // number of extra attempts beyond the first
  baseDelayMs: number; // starting wait before retry
  maxDelayMs: number; // cap wait between retries
  jitter: boolean; // randomize wait time a little to avoid retry storms
}

const DEFAULT_RETRY: RetryOptions = {
  retries: 1,
  baseDelayMs: 300,
  maxDelayMs: 2000,
  jitter: true,
};

/** Enhanced API response shapes with discriminated unions */
export type ApiSuccessResponse<T> = {
  status: true;
  data: T;
};

export type ApiErrorResponse = {
  status: false;
  data: ErrorData;
};

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

/** Error data structure */
interface ErrorData {
  message: string;
  statusCode?: number;
  code?: string;
  [key: string]: unknown;
}

/************************************************************************************
 * ##: Axios instance factory
 * @param {Object} clientOptions - Optional Axios client configuration (use authHeaders for authentication)
 * History:
 * 16-08-2025: Created
 * 21-08-2025: Improved types and error handling
 ************************************************************************************/

interface ClientOptions {
  baseURL?: string;
  timeout?: number;
  defaultHeaders?: Record<string, string>;
  authHeaders?: Record<string, string>;
  onAuthError?: (error: AxiosError, instance: AxiosInstance) => void;
  onRequest?: (config: AxiosRequestConfig) => AxiosRequestConfig | undefined;
  onResponse?: (response: AxiosResponse) => void;
  onError?: (error: AxiosError) => void;
}

/************************************************************************************
 * ##: Creates an Axios instance with interceptors
 * @param {ClientOptions} clientOptions - Optional Axios client configuration
 * History:
 * 21-08-2025: Created
 * 27-08-2025: Fix baseUrl and timeout values - Exported with testing values
 ************************************************************************************/
const apiRequest = (clientOptions: ClientOptions = {}): AxiosInstance => {
  const { baseURL, timeout, defaultHeaders = {}, authHeaders = {}, onAuthError, onRequest, onResponse, onError } = clientOptions;

  // Create a new axios instance with user-defined auth headers
  const instance = axios.create({
    baseURL,
    timeout,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
      ...defaultHeaders,
    },
  });

  /** Attach interceptors:
   * - Request interceptor: can mutate config (e.g. add tracing headers)
   * - Response interceptor: trigger hooks, handle auth errors globally
   */
  instance.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      try {
        if (typeof onRequest === "function") {
          // Convert to basic config type for the hook
          const basicConfig: AxiosRequestConfig = {
            url: config.url,
            method: config.method,
            params: config.params,
            headers: config.headers as Record<string, string>,
            timeout: config.timeout,
            data: config.data,
            responseType: config.responseType,
          };

          const modifiedConfig = onRequest(basicConfig);
          if (modifiedConfig) {
            // Apply changes back to internal config
            Object.assign(config, modifiedConfig);
          }
        }
      } catch (error) {
        console.warn("Error in request interceptor:", error);
      }
      return config;
    },
    (error: any) => Promise.reject(error)
  );

  instance.interceptors.response.use(
    (response: AxiosResponse) => {
      try {
        if (typeof onResponse === "function") onResponse(response);
      } catch (error) {
        console.warn("Error in response interceptor:", error);
      }
      return response;
    },
    (error: AxiosError) => {
      try {
        const status = error?.response?.status;
        if ((status === 401 || status === 403) && typeof onAuthError === "function") {
          onAuthError(error, instance); // e.g. trigger logout
        }
        if (typeof onError === "function") onError(error);
      } catch (interceptorError) {
        console.warn("Error in error interceptor:", interceptorError);
      }
      return Promise.reject(error);
    }
  );

  return instance;
};

/************************************************************************************
 * ##: Normalizers SUCCESS: force all responses into { status, data }
 * Normalize SUCCESS (HTTP 2xx)
 * @param {Object} res - Axios response object
 * History:
 * 16-08-2025: Created
 * 21-08-2025: Improved type safety
 ************************************************************************************/
const normalizeSuccess = <T = unknown>(res: AxiosResponse<T>): ApiSuccessResponse<T> => {
  const payload = res?.data;
  // If server already follows our {status,data} contract, just return it
  if (payload && typeof payload === "object" && "status" in payload && "data" in payload) {
    const typedPayload = payload as { status: boolean; data: T };
    if (typedPayload.status === true) {
      return typedPayload as ApiSuccessResponse<T>;
    }
  }
  // Otherwise wrap raw payload
  return { status: true, data: payload as T };
};

/************************************************************************************
 * ##: Normalizers ERROR: force all responses into { status, data }
 * Normalize ERROR (HTTP !2xx or network)
 * @param {Object} err - Axios error object
 * History:
 * 16-08-2025: Created
 * 21-08-2025: Improved error data extraction
 ************************************************************************************/
const normalizeError = (err: AxiosError): ApiErrorResponse => {
  const r = err?.response;

  // Server already returned {status:false, data} - pass through
  if (r?.data && typeof r.data === "object" && "status" in r.data && "data" in r.data) {
    const typedResponse = r.data as { status: boolean; data: unknown };
    if (typedResponse.status === false) {
      return typedResponse as ApiErrorResponse;
    }
  }

  // Otherwise, build compact error payload
  const responseData = r?.data as Record<string, unknown> | undefined;
  const message = (responseData?.message as string) || (responseData?.error as string) || err?.message || "Request failed";

  const data: ErrorData = responseData && typeof responseData === "object" ? { ...responseData, message } : { message };

  if (r?.status) data.statusCode = r.status;
  if (err?.code) data.code = err.code; // e.g. ECONNABORTED

  return { status: false, data };
};

// Delay function (helper)
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/************************************************************************************
 * ##: Utility function for exponential backoff with jitter
 * It computes the delay (in milliseconds) before retrying an operation.
 * ----------------------------------------------------------------------------------
 * - `attempt` -> current retry number (starting at 1)
 * - `baseDelay` -> initial delay in ms (default: `500`)
 * - `maxDelay` -> maximum allowed delay in ms (default: `10000`)
 * ----------------------------------------------------------------------------------
 * Formula: `delay = baseDelay * 2^(attempt-1)`
 * + random jitter between `80%` and `120%`
 * + capped at `maxDelay`.
 * ----------------------------------------------------------------------------------
 * Prevents overwhelming the server on retries.
 * Reduces collision between clients with random jitter.
 * @param {number} attempt - Current retry attempt (1-based)
 * @param {Object} params - Parameters for backoff computation
 * @param {number} params.baseDelayMs - Initial delay in ms (default: `500`)
 * @param {number} params.maxDelayMs - Maximum allowed delay in ms (default: `10000`)
 * @param {boolean} params.jitter - Whether to apply jitter (default: `true`)
 * History:
 * 16-08-2025: Created
 ************************************************************************************/
const computeBackoff = (attempt: number, { baseDelayMs, maxDelayMs, jitter }: RetryOptions): number => {
  // Exponential backoff: baseDelay * 2^(attempt-1), capped at maxDelay
  const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  if (!jitter) return exp;
  // Add jitter: randomize up to 30% downwards
  const rand = Math.random() * exp * 0.3;
  return Math.min(maxDelayMs, Math.floor(exp - rand));
};

/************************************************************************************
 * ##: Define which errors are worth retrying
 * @param {Object} err - Error object
 * History:
 * 16-08-2025: Created
 ************************************************************************************/
const isRetriable = (err: AxiosError): boolean => {
  const status = err?.response?.status;
  if (!status) return true; // network/timeout
  return status >= 500 && status < 600; // server errors
};

/**
 * **********************************************************************************
 * ##: Runner: wraps any axios call
 * Handles retries, Normalizes result, Never throws (always returns {status,data})
 * It guarantees a normalized result in the shape:
 * { status: true, data } on success
 * { status: false, data: { ...error } } on failure  
 * History:
 * 16-08-2025: Created
 * 21-08-2025: Improved error handling and types
/************************************************************************************/
const run = async <T = unknown>(fn: () => Promise<AxiosResponse<T>>, options: { retry?: Partial<RetryOptions> } = {}): Promise<ApiResponse<T>> => {
  let attempt = 0;
  const retry = { ...DEFAULT_RETRY, ...(options.retry ?? {}) };
  const maxAttempts = 1 + Math.max(0, retry.retries);

  while (attempt < maxAttempts) {
    try {
      const res = await fn();
      return normalizeSuccess<T>(res);
    } catch (err) {
      attempt += 1;
      if (attempt >= maxAttempts || !isRetriable(err as AxiosError)) {
        // Final failure: normalize error and exit
        return normalizeError(err as AxiosError);
      }
      // Wait before next retry
      const wait = computeBackoff(attempt, retry);
      await delay(wait);
    }
  }
  // Should never reach here, but just in case
  return { status: false, data: { message: "Unexpected client error" } };
};

/** /************************************************************************************
 *  Public Factory
 * /*************************************************************************************/

// Input validation helpers
const validateUrl = (url: string): void => {
  if (!url || typeof url !== "string" || url.trim() === "") {
    throw new Error("URL must be a non-empty string");
  }
};

/************************************************************************************
 * ##: Request options interfaces
 * History:
 * 16-08-2025: Created
 * 21-08-2025: Split into specific interfaces for better type safety
 ************************************************************************************/
interface BaseRequestOptions {
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeout?: number;
  responseType?: AxiosRequestConfig["responseType"];
  retry?: Partial<RetryOptions>;
}

interface UploadRequestOptions extends BaseRequestOptions {
  onUploadProgress?: (progressEvent: AxiosProgressEvent) => void;
  fieldName?: string;
}

// For backward compatibility
interface RequestOptions extends BaseRequestOptions {
  onUploadProgress?: (progressEvent: AxiosProgressEvent) => void;
  fieldName?: string;
}

/************************************************************************************
 * ##: Authenticated API Client Factory wrapper
 * Returns an object with HTTP methods: getMany, getOne, post, put, patch, remove, upload, download
 * Each method always returns { status:boolean, data:any } and never throws.
 * @param {Object} clientOptions - Axios client options
 * History:
 * 16-08-2025: Created
 * 21-08-2025: Improved types, validation, and method implementations
 ************************************************************************************/
export const withAuth = (
  clientOptions: ClientOptions = {}
): {
  getMany: <T = unknown>(url: string, opts?: BaseRequestOptions) => Promise<ApiResponse<T[]>>;
  getOne: <T = unknown>(url: string, opts?: BaseRequestOptions) => Promise<ApiResponse<T>>;
  post: <T = unknown>(url: string, payload: unknown, opts?: BaseRequestOptions) => Promise<ApiResponse<T>>;
  put: <T = unknown>(url: string, payload: unknown, opts?: BaseRequestOptions) => Promise<ApiResponse<T>>;
  patch: <T = unknown>(url: string, payload: unknown, opts?: BaseRequestOptions) => Promise<ApiResponse<T>>;
  remove: <T = unknown>(url: string, opts?: BaseRequestOptions) => Promise<ApiResponse<T>>;
  upload: <T = unknown>(url: string, data: FormData | Blob | File | Record<string, unknown>, opts?: UploadRequestOptions) => Promise<ApiResponse<T>>;
  download: (url: string, opts?: BaseRequestOptions) => Promise<ApiResponse<{ blob: Blob; filename?: string }>>;
  raw: AxiosInstance;
} => {
  const api = apiRequest(clientOptions);

  // Utility to merge per-call axios options
  const cfg = (extra: Partial<AxiosRequestConfig> = {}): AxiosRequestConfig => ({ ...extra });

  return {
    getMany: <T = unknown>(url: string, options: BaseRequestOptions = {}): Promise<ApiResponse<T[]>> => {
      validateUrl(url);
      const { params, headers, signal, timeout, responseType, retry } = options;
      return run<T[]>(() => api.get<T[]>(url, cfg({ params, headers, signal, timeout, responseType })), { retry });
    },

    getOne: <T = unknown>(url: string, options: BaseRequestOptions = {}): Promise<ApiResponse<T>> => {
      validateUrl(url);
      const { params, headers, signal, timeout, responseType, retry } = options;
      return run<T>(() => api.get<T>(url, cfg({ params, headers, signal, timeout, responseType })), { retry });
    },

    post: <T = unknown>(url: string, payload: unknown, options: BaseRequestOptions = {}): Promise<ApiResponse<T>> => {
      validateUrl(url);
      const { headers, signal, timeout, responseType, retry } = options;
      return run<T>(() => api.post<T>(url, payload, cfg({ headers, signal, timeout, responseType })), { retry });
    },

    put: <T = unknown>(url: string, payload: unknown, options: BaseRequestOptions = {}): Promise<ApiResponse<T>> => {
      validateUrl(url);
      const { headers, signal, timeout, responseType, retry } = options;
      return run<T>(() => api.put<T>(url, payload, cfg({ headers, signal, timeout, responseType })), { retry });
    },

    patch: <T = unknown>(url: string, payload: unknown, options: BaseRequestOptions = {}): Promise<ApiResponse<T>> => {
      validateUrl(url);
      const { headers, signal, timeout, responseType, retry } = options;
      return run<T>(() => api.patch<T>(url, payload, cfg({ headers, signal, timeout, responseType })), { retry });
    },

    remove: <T = unknown>(url: string, options: BaseRequestOptions = {}): Promise<ApiResponse<T>> => {
      validateUrl(url);
      const { params, headers, signal, timeout, responseType, retry } = options;
      return run<T>(() => api.delete<T>(url, cfg({ params, headers, signal, timeout, responseType })), { retry });
    },

    /** Upload: handles File/Blob/FormData. Returns normalized {status,data} */
    upload: <T = unknown>(url: string, data: FormData | Blob | File | Record<string, unknown>, options: UploadRequestOptions = {}): Promise<ApiResponse<T>> => {
      validateUrl(url);

      const { fieldName = "file", onUploadProgress, headers, signal, timeout, retry } = options;

      let formData: FormData;

      if (data instanceof FormData) {
        formData = data;
      } else if (data instanceof Blob || data instanceof File) {
        formData = new FormData();
        formData.append(fieldName, data);
      } else if (data && typeof data === "object") {
        formData = new FormData();
        Object.entries(data).forEach(([key, value]) => {
          if (value !== null && value !== undefined) {
            formData.append(key, String(value));
          }
        });
      } else {
        throw new Error("Invalid upload data type. Expected FormData, Blob, File, or object.");
      }

      return run<T>(
        () =>
          api.post<T>(
            url,
            formData,
            cfg({
              headers: {
                ...(headers || {}),
                "Content-Type": "multipart/form-data",
              },
              signal,
              timeout,
              onUploadProgress,
            })
          ),
        { retry }
      );
    },

    /** Download as Blob. Returns {status:true,data:{blob,filename?}} */
    download: async (url: string, options: BaseRequestOptions = {}): Promise<ApiResponse<{ blob: Blob; filename?: string }>> => {
      validateUrl(url);

      const { params, headers, signal, timeout, retry } = options;

      // Make the request and get the raw response to access headers
      let response: AxiosResponse<Blob>;
      const result = await run<Blob>(
        async () => {
          response = await api.get<Blob>(
            url,
            cfg({
              params,
              headers,
              signal,
              timeout,
              responseType: "blob",
            })
          );
          return response;
        },
        { retry }
      );

      if (!result.status) {
        return result;
      }

      // Extract filename from Content-Disposition header if available
      let filename: string | undefined;

      try {
        const contentDisposition = response!.headers["content-disposition"];
        if (contentDisposition) {
          const matches = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
          if (matches && matches[1]) {
            filename = matches[1].replace(/['"]/g, "");
          }
        }
      } catch (error) {
        console.warn("Could not extract filename from headers:", error);
      }

      return {
        status: true,
        data: {
          blob: result.data,
          filename,
        },
      };
    },

    /** Expose raw axios instance if needed (for advanced cases) */
    raw: api,
  };
};

/** --------------------------------------------------------------------
 * Resource Helper: sugar for CRUD-ish endpoints
 * ------------------------------------------------------------------ */

/************************************************************************************
 * ##: Resource Helper: sugar for CRUD-ish endpoints
 * @param {string} baseUrl - Base URL for the resource
 * @param {Object} clientOptions - Axios client options (withAuth options)
 * History:
 * 16-08-2025: Created
 * 21-08-2025: Improved validation and type safety
 ************************************************************************************/
export const resource = (
  baseUrl: string,
  clientOptions: ClientOptions = {}
): {
  list: <T = unknown>(query?: Record<string, unknown>, opts?: BaseRequestOptions) => Promise<ApiResponse<T[]>>;
  get: <T = unknown>(id: string | number, opts?: BaseRequestOptions) => Promise<ApiResponse<T>>;
  create: <T = unknown>(payload: unknown, opts?: BaseRequestOptions) => Promise<ApiResponse<T>>;
  update: <T = unknown>(id: string | number, payload: unknown, opts?: BaseRequestOptions) => Promise<ApiResponse<T>>;
  patch: <T = unknown>(id: string | number, payload: unknown, opts?: BaseRequestOptions) => Promise<ApiResponse<T>>;
  remove: <T = unknown>(id: string | number, opts?: BaseRequestOptions) => Promise<ApiResponse<T>>;
  action: <T = unknown>(subpath: string, payload?: unknown, opts?: BaseRequestOptions) => Promise<ApiResponse<T>>;
} => {
  validateUrl(baseUrl);

  const http = withAuth(clientOptions);

  const validateId = (id: string | number): void => {
    if (id === null || id === undefined || id === "") {
      throw new Error("Resource ID must be provided and non-empty");
    }
  };

  const validateSubpath = (subpath: string): void => {
    if (!subpath || typeof subpath !== "string" || subpath.trim() === "") {
      throw new Error("Subpath must be a non-empty string");
    }
  };

  return {
    list: <T = unknown>(query: Record<string, unknown> = {}, opts: BaseRequestOptions = {}) =>
      http.getMany<T>(baseUrl, { ...opts, params: { ...opts.params, ...query } }),

    get: <T = unknown>(id: string | number, opts: BaseRequestOptions = {}) => {
      validateId(id);
      return http.getOne<T>(`${baseUrl}/${id}`, opts);
    },

    create: <T = unknown>(payload: unknown, opts: BaseRequestOptions = {}) => http.post<T>(baseUrl, payload, opts),

    update: <T = unknown>(id: string | number, payload: unknown, opts: BaseRequestOptions = {}) => {
      validateId(id);
      return http.put<T>(`${baseUrl}/${id}`, payload, opts);
    },

    patch: <T = unknown>(id: string | number, payload: unknown, opts: BaseRequestOptions = {}) => {
      validateId(id);
      return http.patch<T>(`${baseUrl}/${id}`, payload, opts);
    },

    remove: <T = unknown>(id: string | number, opts: BaseRequestOptions = {}) => {
      validateId(id);
      return http.remove<T>(`${baseUrl}/${id}`, opts);
    },

    action: <T = unknown>(subpath: string, payload?: unknown, opts: BaseRequestOptions = {}) => {
      validateSubpath(subpath);
      const method = payload !== undefined ? "post" : "get";
      const url = `${baseUrl}/${subpath}`;

      return method === "post" ? http.post<T>(url, payload, opts) : http.getOne<T>(url, opts);
    },
  };
};
