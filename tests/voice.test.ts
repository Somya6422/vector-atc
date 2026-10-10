import { describe, expect, it } from 'vitest';
import { normalize, parseCommands } from '../src/voice/CommandParser';

const one = (s: string) => parseCommands(s)[0];

describe('voice command parser', () => {
  it('converts spoken numbers', () => {
    expect(normalize('heading two seven zero')).toBe('heading 270');
    expect(normalize('climb to four thousand five hundred feet')).toBe('climb to 4500 feet');
    expect(normalize('throttle eighty percent')).toBe('throttle 80 percent');
    expect(normalize('fifteen hundred feet')).toBe('1500 feet');
    expect(normalize('three thousand and fifty')).toBe('3050');
  });
  it('flight controls', () => {
    expect(one('gear down')).toEqual({ t: 'gear', down: true });
    expect(one('Raise the landing gear please')).toEqual({ t: 'gear', down: false });
    expect(one('throttle eighty percent')).toEqual({ t: 'throttle', set: 0.8 });
    expect(one('full power')).toEqual({ t: 'throttle', set: 1 });
    expect(one('afterburner on')).toEqual({ t: 'throttle', set: 1 });
    expect(one('idle')).toEqual({ t: 'throttle', set: 0 });
    expect(one('apply the brakes')).toEqual({ t: 'brake', on: true });
    expect(one('release brakes')).toEqual({ t: 'brake', on: false });
    expect(one('deploy flares')).toEqual({ t: 'flares' });
  });
  it('attitude, heading, altitude', () => {
    expect(one('heading two seven zero')).toEqual({ t: 'heading', deg: 270 });
    expect(one('turn left 45 degrees')).toEqual({ t: 'turn', dir: 'left', deg: 45 });
    expect(one('bank right thirty')).toEqual({ t: 'bank', dir: 'right', deg: 30 });
    expect(one('level the wings')).toEqual({ t: 'level' });
    expect(one('nose up 10 degrees')).toEqual({ t: 'pitch', deg: 10 });
    const c = one('climb to four thousand feet') as { t: 'alt'; meters: number };
    expect(c.t).toBe('alt'); expect(c.meters).toBeCloseTo(1219.2, 0);
    const d = one('descend 1000 feet') as { t: string; meters: number };
    expect(d.t).toBe('alt_rel'); expect(d.meters).toBeCloseTo(-304.8, 0);
    expect(one('hold speed three hundred knots')).toEqual({ t: 'hold_speed', kt: 300 });
  });
  it('assists', () => {
    expect(one('take off')).toEqual({ t: 'autotakeoff' });
    expect(one('taxi to the runway')).toEqual({ t: 'taxi' });
    expect(one('land the aircraft')).toEqual({ t: 'autoland' });
    expect(one('take me home')).toEqual({ t: 'goto_home' });
    expect(one('autopilot off')).toEqual({ t: 'ap_off' });
    expect(one('fly to the next waypoint')).toEqual({ t: 'goto_nav' });
  });
  it('weapons and targets', () => {
    expect(one('select radar missiles')).toEqual({ t: 'weapon', w: 'RADAR' });
    expect(one('switch to guns')).toEqual({ t: 'weapon', w: 'GUN' });
    expect(one('fox two')).toEqual({ t: 'fire', w: 'IR' });
    expect(one('fire the guns')).toEqual({ t: 'fire', w: 'GUN' });
    expect(one('next target')).toEqual({ t: 'target' });
    expect(one('cease fire')).toEqual({ t: 'cease' });
  });
  it('wingman and radio', () => {
    expect(one('cover me')).toEqual({ t: 'wing', cmd: 'cover' });
    expect(one('Specter two, engage my target')).toEqual({ t: 'wing', cmd: 'engage' });
    expect(one('rejoin formation')).toEqual({ t: 'wing', cmd: 'rejoin' });
    expect(one('change to line abreast formation')).toEqual({ t: 'wing', cmd: 'formation', f: 'LINE_ABREAST' });
    expect(one('tell ground I am heading home')).toMatchObject({ t: 'radio', to: 'ground' });
    expect(one('bogey dope')).toEqual({ t: 'report', what: 'enemies' });
  });
  it('camera, panels and menus', () => {
    expect(one('switch to cockpit view')).toEqual({ t: 'camera', view: 'cockpit' });
    expect(one('next camera angle')).toEqual({ t: 'camera', next: true });
    expect(one('pause')).toEqual({ t: 'pause' });
    expect(one('open the map')).toEqual({ t: 'map' });
    expect(one('start engines')).toEqual({ t: 'start_engines' });
    expect(one('new campaign')).toEqual({ t: 'new_campaign' });
    expect(one('select specter two')).toEqual({ t: 'pick_route', route: 'B_GIRL_F35' });
    expect(one('choose the boy')).toEqual({ t: 'pick_route', route: 'A_BOY_SU57' });
    expect(one('launch the mission')).toEqual({ t: 'launch' });
    expect(one('pet the cat')).toEqual({ t: 'interact' });
  });
  it('chains several commands and rejects gibberish', () => {
    expect(parseCommands('gear up and throttle eighty percent then climb to five thousand feet').map(c => c.t)).toEqual(['gear', 'throttle', 'alt']);
    expect(one('purple monkey dishwasher')).toMatchObject({ t: 'unknown' });
    expect(parseCommands('')).toEqual([]);
  });
});
