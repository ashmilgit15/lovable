import { authHeaders } from "./auth";
import { apiUrl } from "./backend";

const API_BASE = apiUrl("/api");

export interface ProjectData {
  id: string;
  name: string;
  description?: string;
  auto_fix_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProjectFile {
  id: string;
  project_id: string;
  filename: string;
  content: string;
  language?: string;
  updated_at: string;
}

export interface ChatMessageData {
  id: string;
  project_id: string;
  role: string;
  content: string;
  created_at: string;
  model_used?: string | null;
}

export interface ProjectDetail {
  project: ProjectData;
  files: ProjectFile[];
  messages: ChatMessageData[];
}

export interface MemoryData {
  stack: string[];
  components: string[];
  color_scheme: string;
  auth: boolean;
  database: string;
  key_decisions: string[];
  last_10_changes: string[];
  features: string[];
  styling: string;
  state_management: string;
}

export interface RoutingConfig {
  default_routing: Record<string, string>;
  classifier_model: string;
  overrides: Record<string, string>;
  effective_routing: Record<string, string>;
  available_models: string[];
}

export interface ProviderPreset {
  label: string;
  base_url: string;
}

export interface ProviderData {
  id: string;
  name: string;
  provider: string;
  model: string;
  base_url?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  has_api_key: boolean;
  api_key_masked: string;
}

export interface TemplateData {
  id: string;
  name: string;
  description: string;
  prompt: string;
  tags: string[];
  thumbnail?: string | null;
  is_builtin: boolean;
}

export interface GenerationData {
  id: string;
  user_message: string;
  files_changed: string[];
  created_at: string;
}

export interface SnapshotData {
  id: string;
  filename: string;
  content?: string;
  created_at: string;
  generation_id: string;
}

export interface PagedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface TodoTaskData {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "done";
}

export interface TodoPlanData {
  project_id: string;
  objective: string;
  tasks: TodoTaskData[];
  project_complete: boolean;
  updated_at: string;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const auth = await authHeaders();
  const headers = { ...auth, ...(init?.headers || {}) };
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const message = await res.text().catch(() => "Request failed");
    throw new Error(message || "Request failed");
  }
  return res.json();
}

export async function createProject(data: {
  name: string;
  description?: string;
  auto_fix_enabled?: boolean;
}): Promise<ProjectData> {
  return fetchJson<ProjectData>(`${API_BASE}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function createProjectFromTemplate(data: {
  name: string;
  prompt: string;
  description?: string;
  auto_fix_enabled?: boolean;
}): Promise<{ project: ProjectData; initial_prompt: string }> {
  return fetchJson<{ project: ProjectData; initial_prompt: string }>(
    `${API_BASE}/projects/from-template`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }
  );
}

export async function listProjects(): Promise<ProjectData[]> {
  return fetchJson<ProjectData[]>(`${API_BASE}/projects`);
}

export async function listProjectsPaged(params?: {
  limit?: number;
  offset?: number;
  search?: string;
}): Promise<PagedResponse<ProjectData>> {
  const query = new URLSearchParams();
  if (params?.limit !== undefined) query.set("limit", String(params.limit));
  if (params?.offset !== undefined) query.set("offset", String(params.offset));
  if (params?.search) query.set("search", params.search);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return fetchJson<PagedResponse<ProjectData>>(`${API_BASE}/projects/paged${suffix}`);
}

export async function getProject(id: string): Promise<ProjectDetail> {
  return fetchJson<ProjectDetail>(`${API_BASE}/projects/${id}`);
}

export async function updateProject(
  id: string,
  data: { name?: string; description?: string; auto_fix_enabled?: boolean }
): Promise<ProjectData> {
  return fetchJson<ProjectData>(`${API_BASE}/projects/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function deleteProject(id: string): Promise<void> {
  await fetchJson(`${API_BASE}/projects/${id}`, { method: "DELETE" });
}

export async function getOllamaStatus(): Promise<{ status: string; url: string }> {
  return fetchJson<{ status: string; url: string }>(`${API_BASE}/ollama/status`);
}

export async function getOllamaModels(): Promise<{ models: string[] }> {
  return fetchJson<{ models: string[] }>(`${API_BASE}/ollama/models`);
}

export async function getProjectMemory(projectId: string): Promise<MemoryData> {
  return fetchJson<MemoryData>(`${API_BASE}/memory/${projectId}`);
}

export async function clearProjectMemory(projectId: string): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>(`${API_BASE}/memory/${projectId}`, {
    method: "DELETE",
  });
}

export async function getRoutingConfig(): Promise<RoutingConfig> {
  return fetchJson<RoutingConfig>(`${API_BASE}/router/config`);
}

export async function updateRoutingOverrides(
  overrides: Partial<Record<"code" | "debug" | "explain" | "design" | "default", string>>
): Promise<{ ok: boolean; overrides: Record<string, string> }> {
  return fetchJson(`${API_BASE}/router/overrides`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(overrides),
  });
}

export async function resetRoutingOverrides(): Promise<{ ok: boolean; overrides: Record<string, string> }> {
  return fetchJson(`${API_BASE}/router/overrides`, {
    method: "DELETE",
  });
}

export async function lintProject(projectId: string): Promise<{
  has_errors: boolean;
  errors: Array<{
    file: string;
    line: number;
    column: number;
    message: string;
    code: string;
    severity: string;
  }>;
  error_count: number;
  raw_output: string;
}> {
  return fetchJson(`${API_BASE}/lint/${projectId}`);
}

export async function getGenerationHistory(projectId: string): Promise<{
  snapshots: SnapshotData[];
  generations: GenerationData[];
}> {
  return fetchJson(`${API_BASE}/lint/${projectId}/snapshots`);
}

export async function getGenerationSnapshots(
  projectId: string,
  generationId: string
): Promise<{
  generation: GenerationData;
  snapshots: SnapshotData[];
}> {
  return fetchJson(`${API_BASE}/lint/${projectId}/generations/${generationId}`);
}

export async function listTemplates(): Promise<TemplateData[]> {
  return fetchJson<TemplateData[]>(`${API_BASE}/templates`);
}

export async function listTemplatesPaged(params?: {
  limit?: number;
  offset?: number;
  search?: string;
}): Promise<PagedResponse<TemplateData>> {
  const query = new URLSearchParams();
  if (params?.limit !== undefined) query.set("limit", String(params.limit));
  if (params?.offset !== undefined) query.set("offset", String(params.offset));
  if (params?.search) query.set("search", params.search);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return fetchJson<PagedResponse<TemplateData>>(`${API_BASE}/templates/paged${suffix}`);
}

export async function saveTemplate(data: {
  name: string;
  description: string;
  prompt: string;
  tags: string[];
}): Promise<TemplateData> {
  return fetchJson<TemplateData>(`${API_BASE}/templates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function deleteTemplate(templateId: string): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>(`${API_BASE}/templates/${templateId}`, {
    method: "DELETE",
  });
}

export async function listCollabUsers(projectId: string): Promise<{
  users: Array<{ id: string; username: string; color: string; is_owner: boolean }>;
}> {
  return fetchJson(`${API_BASE}/collab/${projectId}/users`);
}

export async function startCollabDiscovery(projectId: string): Promise<{
  status: string;
  service: string;
}> {
  return fetchJson(`${API_BASE}/collab/${projectId}/start-discovery`, {
    method: "POST",
  });
}

export async function listProviders(): Promise<{
  providers: ProviderData[];
  presets: Record<string, ProviderPreset>;
}> {
  return fetchJson(`${API_BASE}/providers`);
}

export async function listProvidersPaged(params?: {
  limit?: number;
  offset?: number;
  search?: string;
}): Promise<PagedResponse<ProviderData> & { presets: Record<string, ProviderPreset> }> {
  const query = new URLSearchParams();
  if (params?.limit !== undefined) query.set("limit", String(params.limit));
  if (params?.offset !== undefined) query.set("offset", String(params.offset));
  if (params?.search) query.set("search", params.search);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return fetchJson<PagedResponse<ProviderData> & { presets: Record<string, ProviderPreset> }>(
    `${API_BASE}/providers/paged${suffix}`
  );
}

export async function getActiveProvider(): Promise<{ provider: ProviderData | null }> {
  return fetchJson(`${API_BASE}/providers/active`);
}

export async function createProvider(data: {
  name: string;
  provider: string;
  model: string;
  api_key: string;
  base_url?: string;
  is_active?: boolean;
}): Promise<ProviderData> {
  return fetchJson(`${API_BASE}/providers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function updateProvider(
  providerId: string,
  data: {
    name?: string;
    provider?: string;
    model?: string;
    api_key?: string;
    base_url?: string;
    is_active?: boolean;
  }
): Promise<ProviderData> {
  return fetchJson(`${API_BASE}/providers/${providerId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function activateProvider(providerId: string): Promise<{
  ok: boolean;
  active_provider_id: string;
}> {
  return fetchJson(`${API_BASE}/providers/${providerId}/activate`, {
    method: "POST",
  });
}

export async function deleteProvider(providerId: string): Promise<{ ok: boolean }> {
  return fetchJson(`${API_BASE}/providers/${providerId}`, {
    method: "DELETE",
  });
}

export async function getTodoPlan(projectId: string): Promise<TodoPlanData> {
  return fetchJson<TodoPlanData>(`${API_BASE}/todos/${projectId}`);
}

export async function createTodoPlan(
  projectId: string,
  payload: { objective: string; reset?: boolean }
): Promise<TodoPlanData> {
  return fetchJson<TodoPlanData>(`${API_BASE}/todos/${projectId}/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
