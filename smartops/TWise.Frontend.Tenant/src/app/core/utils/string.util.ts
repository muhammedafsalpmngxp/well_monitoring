export class StringUtil {
  static truncate(value: string, limit = 50, ellipsis = '...'): string {
    if (!value || value.length <= limit) return value;
    return value.substring(0, limit) + ellipsis;
  }

  static toTitleCase(value: string): string {
    return value
      .toLowerCase()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /** A column name for people: cluster_name → Cluster Name, wellId → Well ID. Names with spaces are kept as written. */
  static toLabel(value: string): string {
    if (!value || /\s/.test(value)) return value;
    return value
      .replace(/([a-z\d])([A-Z])/g, '$1 $2')
      .split(/[_.\-]+/)
      .flatMap(part => part.split(' '))
      .filter(Boolean)
      .map(word => /^id$/i.test(word) ? 'ID' : word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  static toKebabCase(value: string): string {
    return value
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .replace(/\s+/g, '-')
      .toLowerCase();
  }

  static isNullOrEmpty(value: string | null | undefined): boolean {
    return !value || value.trim().length === 0;
  }

  static initials(name: string): string {
    return name
      .split(' ')
      .slice(0, 2)
      .map(n => n.charAt(0).toUpperCase())
      .join('');
  }
}
