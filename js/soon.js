// "Coming soon" mode: only the background scene and scroll effects run. No coin checks, search
// or feed, so no data APIs are called. To launch, follow the steps in README.md.

import { startHeroScene } from './hero.js';
import { wireScroll } from './scroll.js';

wireScroll();
startHeroScene();
