export type ExtensionCategory = 'plugin' | 'theme' | 'template';
export type ExtensionStatus = 'available' | 'in_development';

export interface ExtensionItem {
  id: string;
  name: string;
  version: string;
  category: ExtensionCategory;
  description: string;
  author: string;
  downloads: string;
  icon: string;
  status: ExtensionStatus;
  isBuiltin?: boolean;
  installable: boolean;
  payload?: any;
}
