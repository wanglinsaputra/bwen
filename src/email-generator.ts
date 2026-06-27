function generateDotVariants(localPart: string): string[] {
  const n = localPart.length;
  if (n <= 1) return [localPart];

  const results: string[] = [];
  const total = 1 << (n - 1);

  for (let mask = 1; mask < total; mask++) {
    let variant = '';
    for (let i = 0; i < n; i++) {
      variant += localPart[i];
      if (i < n - 1 && (mask & (1 << i)) !== 0) {
        variant += '.';
      }
    }
    results.push(variant);
  }

  return results;
}

export function getVariantCount(localPart: string): number {
  return (1 << (localPart.length - 1)) - 1;
}

export function generateAllEmails(rawEmail: string): string[] {
  const [localPart, domain] = rawEmail.split('@');
  if (!domain) {
    throw new Error(`Invalid email format: ${rawEmail}`);
  }

  const variants = generateDotVariants(localPart);
  const unique = [...new Set(variants)];
  return unique.map((v) => `${v}@${domain}`);
}
