import { promises as fs } from "fs";
import path from "path";

export class StorageHelper {
  constructor(private baseDir: string) {}

  async readJson<T>(filePath: string): Promise<T | null> {
    try {
      const content = await fs.readFile(path.join(this.baseDir, filePath), "utf-8");
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }

  async writeJson(filePath: string, data: any): Promise<void> {
    const fullPath = path.join(this.baseDir, filePath);
    const dir = path.dirname(fullPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(fullPath, JSON.stringify(data, null, 2), "utf-8");
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.baseDir, filePath));
      return true;
    } catch {
      return false;
    }
  }

  async listFiles(dirPath: string): Promise<string[]> {
    try {
      const fullPath = path.join(this.baseDir, dirPath);
      const files = await fs.readdir(fullPath);
      return files.filter(f => f.endsWith('.json'));
    } catch {
      return [];
    }
  }
}