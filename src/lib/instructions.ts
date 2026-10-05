import { translate, type Language, type StringKey } from '../i18n';
import type { Modifier, Step } from './routing';

const TURN_KEYS: Record<Modifier, StringKey> = {
  left: 'turn.left', right: 'turn.right', 'slight left': 'turn.slightLeft', 'slight right': 'turn.slightRight',
  'sharp left': 'turn.sharpLeft', 'sharp right': 'turn.sharpRight', uturn: 'turn.uturn', straight: 'turn.straight',
};

const DIRECTIONS: StringKey[] = ['dir.north', 'dir.northeast', 'dir.east', 'dir.southeast', 'dir.south', 'dir.southwest', 'dir.west', 'dir.northwest'];

function compass(lang: Language, bearing = 0) {
  return translate(lang, DIRECTIONS[Math.round(bearing / 45) % 8]);
}

function ordinal(lang: Language, n = 1) {
  return translate(lang, `ordinal.${Math.min(Math.max(n, 1), 6)}` as StringKey);
}

// Arabic street names are shown as-is on the map but read poorly in English/Somali voice prompts.
function streetName(street?: string) {
  const latin = street?.replace(/[؀-ۿ]+/g, '').replace(/[\s/]+$/g, '').replace(/\s+/g, ' ').trim();
  return latin || undefined;
}

/** Builds a localized instruction from a normalized routing step (independent of the router's own language). */
export function instructionFor(lang: Language, step: Step): string {
  const street = streetName(step.street);
  switch (step.kind) {
    case 'depart':
      return street ? translate(lang, 'instr.departOn', { dir: compass(lang, step.bearingAfter), street })
        : translate(lang, 'instr.depart', { dir: compass(lang, step.bearingAfter) });
    case 'arrive':
      return translate(lang, step.modifier === 'left' ? 'instr.arriveLeft' : step.modifier === 'right' ? 'instr.arriveRight' : 'instr.arrive');
    case 'roundabout':
      return street ? translate(lang, 'instr.roundaboutOnto', { nth: ordinal(lang, step.exit), street })
        : translate(lang, 'instr.roundabout', { nth: ordinal(lang, step.exit) });
    case 'keep':
      return translate(lang, step.modifier === 'left' ? 'instr.keepLeft' : 'instr.keepRight');
    case 'merge':
      return translate(lang, 'instr.merge');
    case 'continue':
      return street ? translate(lang, 'instr.continueOn', { street }) : translate(lang, 'instr.continue');
    case 'turn': {
      const turn = translate(lang, TURN_KEYS[step.modifier ?? 'straight']);
      return street ? translate(lang, 'instr.turnOnto', { turn, street }) : turn;
    }
  }
}

/** "In 200 meters, turn right onto …" for voice prompts. */
export function spokenInstruction(lang: Language, distance: string, instruction: string) {
  const lowered = instruction.charAt(0).toLowerCase() + instruction.slice(1);
  return translate(lang, 'instr.inDistance', { distance, instruction: lowered });
}

/** Ionicons-style glyph name for the maneuver banner. */
export function maneuverIcon(step?: Step): string {
  if (!step) return 'arrow-up';
  if (step.kind === 'arrive') return 'flag';
  if (step.kind === 'roundabout') return 'refresh';
  const m = step.modifier;
  if (m === 'uturn') return 'arrow-undo';
  if (m?.includes('left')) return m === 'slight left' ? 'arrow-up-outline' : 'arrow-back';
  if (m?.includes('right')) return m === 'slight right' ? 'arrow-up-outline' : 'arrow-forward';
  return 'arrow-up';
}
