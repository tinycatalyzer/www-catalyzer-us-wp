// External Dependencies
import difference from 'lodash/difference';
import forEach from 'lodash/forEach';
import get from 'lodash/get';
import isEqual from 'lodash/isEqual';
import keys from 'lodash/keys';
import pick from 'lodash/pick';
import $ from 'jquery';

// Internal dependencies
import ETScriptStickyElement from './sticky-element';
import ETScriptStickyStore from '../stores/sticky';
import {
  isBFB,
  isLBB,
  isTB,
  isVB,
} from '../utils/utils';

// Modules that use sticky element feature
const stickyInstances = {};

/**
 * Initialize Sticky Elements;
 * Front-end: loads settings from store (which is loaded from global variable passed
 *            via wp_localize_script())
 * Builder:   adds store listener which will listen to Sticky Element settings change
 *            pushed by builder's ETBuilderCustomCSSOutput component.
 *
 * @since 4.6.0
 */
if (isVB || isBFB || isTB || isLBB) {
  /**
   * Get Sticky Elements instances that need to be removed and unset from currently initialized
   * stickyInstances list by incoming settings from store and stickyInstances.
   *
   * @since 4.6.0
   *
   * @returns {Array}
   */
  function getUnsetStickyElements() {
    // Get id of currently initialized ETScriptStickyElement
    const currentInstanceIds = keys(stickyInstances);

    // Get sticky settings from store
    const stickyModules = ETScriptStickyStore.modules;

    // Get id of settings from store
    const stickyModuleIds = keys(stickyModules);

    // If currently initialized ETScriptStickyElement id doesn't exist on store's settings id, it
    // means the ETScriptStickyElement is either removed or has its sticky status removed
    // (sticky_position attribute is set to `none`)
    return difference(currentInstanceIds, stickyModuleIds);
  }

  /**
   * Store's setting change listener callback.
   *
   * @since 4.6.0
   */
  function onStickySettingsChange() {
    // Loop over unset sticky elements then remove their instances
    forEach(getUnsetStickyElements(), id => {
      // End sticky state, and removed isSticky prop
      stickyInstances[id].endSticky();
      stickyInstances[id].setProp('isSticky', false);

      // Remove ETScriptStickyElement listener
      stickyInstances[id].removeListeners();

      // Remove instance
      delete stickyInstances[id];
    });

    // Loop over incoming sticky element settings from store
    forEach(ETScriptStickyStore.modules, (settings, id) => {
      // Check whether current setting has been initialized; if true, it means the sticky element
      // is being updated
      const currentStickyInstance = get(stickyInstances, id);

      // Update sticky element
      if (currentStickyInstance) {
        // Check if current instance is equal to incoming settings from store. Current instance
        // has less attribute than store's because some attribute are generated on the fly at store.
        // Thus, omit attribute differences during comparison
        const instanceSettingsKeys = keys(currentStickyInstance.getSettings());
        const instanceInSettings   = pick(settings, instanceSettingsKeys);

        // If incoming settings are equal with current instance's settings, bail
        if (isEqual(currentStickyInstance.getSettings(), instanceInSettings)) {
          return;
        }

        // Update settings, then set initial props
        stickyInstances[id].setSettings(settings, true);
      } else {
        // Create new ETScriptStickyElement instance
        stickyInstances[id] = new ETScriptStickyElement(settings);
      }
    });
  }

  // Attach callback to store's settings change event
  ETScriptStickyStore.addSettingsChangeListener(onStickySettingsChange);
} else {
  // Need to wait until document is ready to get correct offset values
  $(() => {
    forEach(ETScriptStickyStore.modules, (settings, id) => {
      // Create sticky element instance
      stickyInstances[id] = new ETScriptStickyElement(settings);
    });
  });
}
