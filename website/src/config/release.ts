export const repository = 'https://github.com/grouzdev/harbor-player';

export type Release = {
  version: string | null;
  channel: 'unreleased' | 'unsigned-beta' | 'stable';
  installer: string | null;
  portable: string | null;
  notes: string;
};

// Populate only after checking the actual published GitHub release assets.
export const release: Release = {
  version: null,
  channel: 'unreleased',
  installer: null,
  portable: null,
  notes: `${repository}/releases`,
};

export function releaseState(value: Release) {
  const available = value.channel !== 'unreleased' && Boolean(value.version && value.installer);
  return {
    available,
    installer: available ? value.installer : null,
    portable: available ? value.portable : null,
    unsigned: available && value.channel === 'unsigned-beta',
  };
}
