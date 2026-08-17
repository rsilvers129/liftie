import select from '../../select.js';
import * as domutil from '../../tools/domutil.js';

/*
 * ORDA sites are fetched through a headless browser - see lib/lifts/browser.js.
 *
 * Rows are matched by class rather than child position: the older markup put a
 * lift-type icon before the name, the current one does not.
 */
const first = (node, selector) => select(node, selector)[0];

export default {
  selector: '.lifts-row',
  parse: {
    name: node => domutil.findText(first(node, '.lift-name')),
    status: node => first(node, '.lift-icon img')?.attribs?.src?.match(/icon-([a-z-]+)\.svg/)?.[1]
  }
};
