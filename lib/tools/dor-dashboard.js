import select from '../select.js';
import * as domutil from './domutil.js';

/*
 * Killington and Pico left Powdr and moved to their own status dashboard.
 *
 * Their old api.<resort>.com endpoints still answer and still list every lift,
 * but nothing has updated them since the resorts changed hands - every lift is
 * pinned to whatever it was months ago. They have to be read from the rendered
 * page instead, which needs a browser (see lib/lifts/browser.js).
 *
 * A lift appears once per mountain area it serves, so the same name shows up
 * several times with the same status. collect() keys by name, which folds the
 * duplicates back together.
 *
 * allText rather than findText: the name div leads with an icon span, and
 * findText would descend into it and come back empty.
 */
const first = (node, selector) => select(node, selector)[0];

export default {
  selector: '.lift-card[data-lift-status]',
  parse: {
    name: node => domutil.allText(first(node, '.lift-name')),
    status: {
      attribute: 'data-lift-status'
    }
  }
};
