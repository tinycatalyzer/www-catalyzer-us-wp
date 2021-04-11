// External dependencies
import debounce from 'lodash/debounce';
import filter from 'lodash/filter';
import forEach from 'lodash/forEach';
import get from 'lodash/get';
import has from 'lodash/has';
import includes from 'lodash/includes';
import isArray from 'lodash/isArray';
import isEmpty from 'lodash/isEmpty';
import isFunction from 'lodash/isFunction';
import isNaN from 'lodash/isNaN';
import isNull from 'lodash/isNull';
import isNumber from 'lodash/isNumber';
import isObject from 'lodash/isObject';
import isString from 'lodash/isString';
import isUndefined from 'lodash/isUndefined';
import set from 'lodash/set';
import startsWith from 'lodash/startsWith';
import $ from 'jquery';

// Internal dependencies
import {
  getPercentage,
  hasValue,
} from '@frontend-builder/utils/pure';
import { getUnit } from '@frontend-builder/utils/et-builder-sanitize';
import ETScriptWindowStore from '../stores/window';
import ETScriptDocumentStore from '../stores/document';
import ETScriptStickyStore from '../stores/sticky';
import {
  getOffsets,
  isBuilder,
  isDiviTheme,
  isExtraTheme,
  isFE,
  isLBP,
  isVB,
  isBFB,
  setImportantInlineValue,
} from '../utils/utils';
import {
  getLimit,
  getStickyStyles,
  trimTransitionValue,
} from '../utils/sticky';
import {
  toggleAllBackgroundLayoutClassnameOnSticky,
} from './background-layout';


class ETScriptStickyElement {
  /**
   * Sticky element settings which is passed from builder.
   *
   * @since 4.6.0
   *
   * @type {object}
   */
  settings = {};

  /**
   * Sticky element properties.
   *
   * @since 4.6.0
   */
  props = {
    id: null,
    $selector: null,
    position: null,
    topBottomPosition: null,
    customTopOffset: 0,
    customBottomOffset: 0,
    height: 0,
    heightSticky: 0,
    offsets: {},
    isSticky: null,
    isPaused: null,
    pauseScrollTop: false,
    topLimitSettings: false,
    bottomLimitSettings: false,
    themeFixedPrimaryNavHeight: 0,
  };

  /**
   * Props that need to be synced to sticky store so other sticky element can access
   * calculated value of other sticky element (eg. For offset surrounding).
   *
   * @since 4.6.0
   *
   * @type {object}
   */
  storeSync = [
    'id',
    'isSticky',
    'isPaused',
    'customTopOffset',
    'customBottomOffset',
    'height',
    'heightSticky',
    'width',
    'widthSticky',
    'paddingSticky',
    'offsets',
    'topLimit',
    'bottomLimit',
    'topLimitSettings',
    'bottomLimitSettings',
  ];

  /**
   * Classname that is used for <style> tag for adding temporary height lock.
   *
   * @since 4.6.0
   *
   * @type {string}
   */
  lockStyleClassname = 'et-script-sticky-temporary-height-lock';

  /**
   * Timeout for startSticky's final style.
   *
   * @since 4.6.0
   *
   * @type {number}
   */
  startStickyFinalStyleTimeout;

  /**
   * Timeout for endSticky's unlock parent timeout.
   *
   * @since 4.6.0
   *
   * @type {number}
   */
  endStickyUnlockParentTimeout;

  /**
   * StrickyElement constructor.
   *
   * @since 4.6.0
   *
   * @param {object} settings
   * @param {string} settings.position
   */
  constructor(settings) {
    // Save settings as class property
    this.setSettings(settings);

    // Props that needs to be re-inited on certain events (eg. breakpoint change)
    this.setInitialProps();

    // Call onWindowScroll to make element adjusted on page load. Set 0-second timeout so
    // the scroll callback is executed on the next cycle; this is particularly useful
    // when offset surrounding is activated and other sticky element's dimension affects
    // current sticky element's offset calculation
    setTimeout(() => this.onWindowScroll(), 0);

    // Update sticky props and element attribute on window scroll event
    ETScriptWindowStore.addScrollTopChangeListener(this.onWindowScroll);

    // Update sticky props and element attribute when window width is changed
    ETScriptWindowStore.addWidthChangeListener(this.onWindowWidthChange);

    // Update sticky props and element attribute when window height is changed
    ETScriptWindowStore.addHeightChangeListener(this.onWindowHeightChange);

    // Update responsive props when breakpoint change
    ETScriptWindowStore.addBreakpointChangeListener(this.onBreakpointChange);

    // Update props when scroll location change
    ETScriptWindowStore.addScrollLocationChangeListener(this.onWindowScrollLocationChange);

    // Update related props when document height / width is changed
    ETScriptDocumentStore.addDimensionChangeListener(this.onDocumentDimensionChange);

    // Update related properties when Divi's main-header transition to fixed header is done
    window.addEventListener('ETDiviFixedHeaderTransitionEnd', this.onDiviFixedHeaderTransitionEnd);

    // Set dimension observer
    this.domObserver = new MutationObserver(this.onDomChange);

    const selectorNode = this.getProp('$selector')[0];

    // Check selector node type before observing to prevent error
    if ('object' === typeof selectorNode) {
      this.domObserver.observe(selectorNode, {
        attributes: true,
        childList: true,
        subtree: true,
      });
    }

    // Flag if document is automatically scrolled on page load and need props need to be reinitialized
    // when ending sticky state to keep props accurate on next sticky state
    this.resetInitialPropsOnStickyEnd = 0 < window.scrollY;
  }

  /**
   * Remove registered event listeners.
   *
   * @since 4.6.0
   */
  removeListeners = () => {
    // Remove registered event listeners of current sticky element instance
    ETScriptWindowStore.removeScrollTopChangeListener(this.onWindowScroll);
    ETScriptWindowStore.removeWidthChangeListener(this.onWindowWidthChange);
    ETScriptWindowStore.removeBreakpointChangeListener(this.onBreakpointChange);
    ETScriptWindowStore.removeScrollLocationChangeListener(this.onWindowScrollLocationChange);
    ETScriptDocumentStore.removeDimensionChangeListener(this.onDocumentDimensionChange);

    window.removeEventListener('ETDiviFixedHeaderTransitionEnd', this.onDiviFixedHeaderTransitionEnd);

    // Disconnect dimension observer
    this.domObserver.disconnect();
  }

  /**
   * Get Sticky Element settings. The settings are passed from builder.
   *
   * @since 4.6.0
   *
   * @returns {object}
   */
  getSettings = () => this.settings

  /**
   * Get element prop name of fixed header of supported theme.
   *
   * @since 4.6.0
   *
   * @returns {string}
   */
  getThemeFixedPrimaryNavName = () => {
    if (isDiviTheme) {
      return 'diviFixedPrimaryNav';
    }

    if (isExtraTheme) {
      return 'extraFixedPrimaryNav';
    }

    return false;
  }

  /**
   * Set settings passed from builder as Sticky Element settings.
   *
   * @since 4.6.0
   * @param {object}
   * @param settings
   * @param triggerUpdate
   * @param {bool}
   */
  setSettings = (settings, triggerUpdate = false) => {
    this.settings = {
      ...settings,
    };

    // Set settings-based props
    this.setProp('id', settings.id);
    this.setProp('$selector', $(`${settings.selector}:not(.et_pb_sticky_placeholder)`));

    if (this.getProp('$selector').closest('.et-l--header').length > 0) {
      this.setProp('isInsideTbHeader', true);
    }

    if (this.getProp('$selector').closest('.et-l--footer').length > 0) {
      this.setProp('isInsideTbFooter', true);
    }

    // Trigger UI update
    if (triggerUpdate) {
      this.setInitialProps();

      // Set the following on next cycle to ensure that all props have been updated
      setTimeout(() => {
        // End sticky, set sticky to false, then trigger window scroll event callback to
        // re-create sticky condition
        this.endSticky();
        this.setProp('isSticky', false);

        // Execute window scroll callback on next cycle to trigger immediate re-rendering
        this.onWindowScroll();
      }, 10);
    }
  }

  /**
   * Get setting value.
   *
   * @since 4.6.0
   *
   * @param {string} name
   * @param {mixed}  defaultValue
   *
   * @returns {mixed}
   */
  getSetting = (name, defaultValue) => {
    const setting               = get(this.settings, name, defaultValue);
    const { responsiveOptions } = ETScriptStickyStore;

    const isResponsive = isObject(setting)
      && has(setting, 'desktop')
      && (startsWith(name, 'styles.') || startsWith(name, 'stickyStyles.') || includes(responsiveOptions, name));

    return isResponsive ? get(setting, ETScriptWindowStore.breakpoint, defaultValue) : setting;
  }

  /**
   * Get prop value.
   *
   * @since 4.6.0
   *
   * @param {string} name
   * @param {mixed}  defaultValue
   *
   * @returns {mixed}
   */
  getProp = (name, defaultValue) => get(this.props, name, defaultValue);

  /**
   * Check if prop value equal to given value.
   *
   * @todo Memoize this later for performance.
   *
   * @since 4.6.0
   *
   * @param {string} name Prop name.
   * @param {mixed}  value Value to be checked against prop value.
   *
   * @returns {bool}
   */
  isProp = (name, value) => value === this.getProp(name);

  /**
   * Set prop value.
   *
   * @since 4.6.0
   *
   * @param {string} name
   * @param {mixed}  value
   */
  setProp = (name, value) => {
    set(this.props, name, value);

    // Sync to sticky store if needed
    if (includes(this.storeSync, name)) {
      ETScriptStickyStore.setProp(this.getProp('id'), name, value);
    }
  }

  /**
   * Set initial props
   * This need to be re-initialized after certain event, hence abstracted into method.
   *
   * @since 4.6.0
   * @since 4.6.2 Added param to force update the dimension props.
   */
  setInitialProps = (forceUpdate = false) => {
    // Check sticky status and $element for measuring state value. When sticky, measure against
    // $placeholder since it is clone of actual module placed on original location which means it
    // has actual dimension and offset. When not sticky, measure against module itself
    const isSticky = this.getProp('isSticky');
    let $element   = isSticky ? this.getPlaceholder() : this.getProp('$selector');

    // Module DOM might not be ready the first time sticky is initiated on visual builder because
    // it still fetches the HTML value over computed callback. Thus in visual builder, check for
    // DOM existence first; re-fetch and re-set $selector props if needed
    if (! isSticky && isBuilder && $element.length < 1) {
      $element = $(`${this.getSetting('selector')}:not(.et_pb_sticky_placeholder)`);

      this.setProp('$selector', $element);
    }

    // Set props that are based on settings passed from builder
    this.setProp('position', this.getSetting('position'));
    this.setProp('topOffsetModules', this.getSetting('topOffsetModules'));
    this.setProp('bottomOffsetModules', this.getSetting('bottomOffsetModules'));

    // Set limits; has to be called after $selector prop has been saved
    const isStickyBottom = this.isProp('position', 'bottom') || this.isProp('position', 'top_bottom');
    const isStickyTop    = this.isProp('position', 'top') || this.isProp('position', 'top_bottom');

    if (isStickyBottom) {
      const topLimit = this.getSetting('topLimit');

      this.setProp('topLimitSettings', getLimit(this.getProp('$selector'), topLimit));
    }

    if (isStickyTop) {
      const bottomLimit = this.getSetting('bottomLimit');

      this.setProp('bottomLimitSettings', getLimit(this.getProp('$selector'), bottomLimit));
    }

    // Prevent updating initial props if module or ancestors is currently animated by animation
    // options; Currently animated module might have incorrect offset and dimension which will
    // cause incorrect positioning when sticky module enters sticky state. NOTE: initial props
    // that are based on settings and limit related prop still need to be processed because they
    // are less likely to be affected by the animation but still likely changed when
    // setInitialProps() is called.
    if ($element.closest('.et_is_animating').length > 0) {
      return;
    }

    // Reset style by removing existing on-page sticky module style to avoid duplication
    this.getProp('$selector').find('.et_pb_sticky_module_style').remove();

    // Set props that are based on DOM calculation. NOTE: on initialization at frontend, stickyStore
    // already set width, height, and offsets props value on store level because it is needed
    // to adjust topOffsetModules / bottomOffsetModules props to make it adjacent column-aware.
    // However, they are still updated here because they need to be adjusted on various events
    const width   = this.getModuleWidth();
    const height  = parseInt($element.outerHeight());
    const offsets = getOffsets($element, width, height);
    const padding = $element.css('padding');

    // If not force update, Only update dimension props if module isn't on sticky state
    if (! isSticky || forceUpdate) {
      this.setProp('offsets', offsets);
      this.setProp('width', width);
      this.setProp('height', height);
      this.setProp('marginLeft', parseFloat($element.css('marginLeft')));
      this.setProp('marginRight', parseFloat($element.css('marginRight')));
    }

    // Measure height on sticky state so accurate style property can be immediately used without
    // the need of waiting style transition which causes inaccurate sticky behavior rendering
    const stickyStyles = getStickyStyles(this.getProp('id'), this.getProp('$selector'), this.getPlaceholder());

    this.setProp('heightSticky', get(stickyStyles, 'height', height));
    this.setProp('widthSticky', get(stickyStyles, 'width', width));
    this.setProp('paddingSticky', get(stickyStyles, 'padding', padding));
    this.setProp('customTopOffset', this.parseOffsetToPx(this.getSetting('topOffset')));
    this.setProp('customBottomOffset', this.parseOffsetToPx(this.getSetting('bottomOffset')));
    this.setProp('marginLeftSticky', stickyStyles.marginLeft);
    this.setProp('marginRightSticky', stickyStyles.marginRight);

    // Append on-page helper style
    this.setOnPageHelperStyles();
  }

  /**
   * Update inline styles. Only to be called while module is in sticky state.
   *
   * @since 4.6.0
   */
  updateInlineStyles = () => {
    const stickyStyles          = {};
    const renderedStickyStyles  = getStickyStyles(this.getProp('id'), this.getProp('$selector'), this.getPlaceholder());
    const placeholderDomWidth   = this.getPlaceholder().outerWidth();
    const stickyStyleWidth      = this.getPropertyValueInPx('stickyStyles.width', this.getPropertyValueInPx('styles.width', get(renderedStickyStyles, 'width', placeholderDomWidth)));
    const stickyStyleMaxWidth   = this.getPropertyValueInPx('stickyStyles.max-width', this.getPropertyValueInPx('styles.max-width'));
    const placeholderDomOffsets = getOffsets(this.getPlaceholder(), placeholderDomWidth, this.getPlaceholder().outerHeight());

    if (stickyStyleWidth) {
      stickyStyles.width = isNumber(stickyStyleWidth) ? `${stickyStyleWidth}px` : stickyStyleWidth;

      // Set prop so `getFinalInlineStyleLeft()` below correctly calculate `left` with updated width.
      if (this.getProp('isSticky')) {
        this.setProp('width', this.getPlaceholder().outerWidth());
      }
    }

    if (stickyStyleMaxWidth) {
      stickyStyles.maxWidth = isNumber(stickyStyleMaxWidth) ? `${stickyStyleMaxWidth}px` : stickyStyleMaxWidth;
    }

    // No custom width is found: still need to check whether module width needs to be updated or not.
    // Browser event might affect sticky module height (eg. window is resized, row width uses %).
    if (isUndefined(stickyStyles.width)) {
      const stickyDomWidth       = this.getProp('$selector').outerWidth();
      const hasCustomStickyWidth = this.getProp('width') !== this.getProp('widthSticky');

      // Sticky and placeholder width on prop are equal but the sticky and placeholder DOM width
      // differs means browser event occurs causes sticky module width change.
      if (! hasCustomStickyWidth && stickyDomWidth !== placeholderDomWidth) {
        stickyStyles.width = `${placeholderDomWidth}px`;
        stickyStyles.left  = isNumber(placeholderDomOffsets.left) ? `${placeholderDomOffsets.left}px` : placeholderDomOffsets.left;

        this.setProp('width', placeholderDomWidth);
        this.setProp('widthSticky', placeholderDomWidth);
      }
    }

    // Module placeholder offset will change when window / document dimension change. Update offsets
    // prop because `getFinalInlineStyleLeft()` below rely on offsets.left value.
    this.setProp('offsets', placeholderDomOffsets);

    // If no inline maxWidth or width value found stop to avoid unwanted inline left update
    if (isEmpty(stickyStyles)) {
      return;
    }

    const stickyStyleLeft = this.getFinalInlineStyleLeft();

    if (stickyStyleLeft) {
      stickyStyles.left = isNumber(stickyStyleLeft) ? `${stickyStyleLeft}px` : stickyStyleLeft;
    }

    this.getProp('$selector').css(stickyStyles);
  }

  /**
   * Append on-page helper style. Some styles need to be overriden to work smoothly hence being
   * added as on-page style (eg. Percentage based module width needs to be converted to fixed px
   * width because on sticky state which uses fixed positioning, percentage uses viewport width
   * as reference instead of parent width ).
   *
   * @since 4.6.0
   */
  setOnPageHelperStyles = () => {
    const moduleWidth    = this.getPropertyValueInPx(`styles.width.${ETScriptWindowStore.breakpoint}`);
    const moduleMaxWidth = this.getPropertyValueInPx(`styles.max-width.${ETScriptWindowStore.breakpoint}`);

    let onPageHelperStyles = '';

    if (hasValue(moduleWidth)) {
      onPageHelperStyles += `width: ${moduleWidth}px;`;
    }

    if (hasValue(moduleMaxWidth)) {
      onPageHelperStyles += ` max-width: ${moduleMaxWidth}px;`;
    }

    if (hasValue(onPageHelperStyles)) {
      this.getProp('$selector').append(`<style class="et_pb_sticky_module_style">
        ${this.getSetting('selector')}.et_pb_sticky_module:not(.et_pb_sticky--editing) {${onPageHelperStyles}}
      </style>`);
    }
  }

  /**
   * Check if element uses particular sticky position
   * If responsive setting is used, this automatically match the result with current breakpoint.
   *
   * @since 4.6.0
   *
   * @param {string} position
   *
   * @returns {bool}
   */
  hasSticky = position => position === this.getSetting(position);

  /**
   * Convert module defined offset into px-based eqivalent. Calculation is performed in px.
   *
   * @todo Convert more unit to px.
   * @param settingOffset
   * @since 4.6.0
   * @param {string}
   * @returns {number}
   */
  parseOffsetToPx = settingOffset => {
    if (! hasValue(settingOffset)) {
      return 0;
    }

    const unit = getUnit(settingOffset);

    let pxOffset = 0;

    switch (unit) {
      case 'px':
        pxOffset = parseInt(settingOffset);
        break;

      // No known unit; treat it as unitless px
      default:
        pxOffset = parseInt(settingOffset);
        break;
    }

    return pxOffset;
  }

  /**
   * Get accurate module width.
   *
   * @since 4.6.0
   *
   * @returns {number}
   */
  getModuleWidth = () => {
    const $element = this.getProp('$selector');
    const element  = document.querySelector(`${this.getSetting('selector')}:not(.et_pb_sticky_placeholder)`);
    const width    = parseInt($element.outerWidth());

    // getComputedStyle() tends to get more accurate computed width down to three decimal digits
    // compared to jQuery's outerWidth(). This is mostly needed when the module's width is less
    // than its wrapper and have auto width like button module where a slight width difference could
    // create unwanted newline break when the inaccurate fixed width is added on sticky state
    if (isFunction(window.getComputedStyle) && ! isNull(element)) {
      const selector     = `${this.getSetting('selector')}:not(.et_pb_sticky_placeholder)`;
      const preciseWidth = parseFloat(getComputedStyle(document.querySelector(selector)).width);

      if (preciseWidth > width) {
        return preciseWidth;
      }
    }

    return width;
  }

  /**
   * Get overall offset position.
   *
   * @since 4.6.0
   * @param {string} position Top|bottom.
   * @param include
   * @param {string | Array} all|custom|surrounding|knownElement
   */
  getOffset = (position, include = 'all') => {
    // Determine whether given offsetType should be included in offset calculation
    const shouldInclude = offsetType => 'all' === include || offsetType === include || (isArray(include) && includes(include, offsetType));

    const offsetPropName      = 'top' === position ? 'customTopOffset' : 'customBottomOffset';
    const customOffset        = shouldInclude('custom') ? this.getProp(offsetPropName) : 0;
    const isTopPosition       = 'top' === position;
    const isBottomPosition    = 'bottom' === position;
    const topOffsetModules    = isTopPosition && this.getProp('topOffsetModules');
    const bottomOffsetModules = 'bottom' === position && this.getProp('bottomOffsetModules');
    const offsetSurrounding   = 'on' === this.getSetting('offsetSurrounding');
    const offsetModules       = ! offsetSurrounding ? false : isTopPosition ? topOffsetModules : bottomOffsetModules;

    // Surrounding module offset
    let surroundingOffsetTop = 0;

    if (shouldInclude('surrounding') && offsetModules) {
      forEach(offsetModules, id => {
        // Make sure that valid number is passed to surroundingOffsetTop. Double check since `NaN`
        // is considered number (which will mess the calculation if passed)
        const surroundingCustomOffsetTop = ETScriptStickyStore.getProp(id, offsetPropName, 0);

        if (isNumber(surroundingCustomOffsetTop) && surroundingCustomOffsetTop) {
          surroundingOffsetTop += ETScriptStickyStore.getProp(id, offsetPropName, 0);
        }

        const surroundingHeight = ETScriptStickyStore.getProp(id, 'heightSticky', 0);

        if (isNumber(surroundingHeight) && surroundingHeight) {
          surroundingOffsetTop += ETScriptStickyStore.getProp(id, 'heightSticky', 0);
        }
      });
    }

    // Known Element Offset
    let knownElementOffset = 0;

    if (shouldInclude('knownElement')) {
      // Always include admin bar height into offset consideration if it exist
      if (isTopPosition && ! isLBP && ETScriptStickyStore.getElementProp('wpAdminBar', 'exist', false)) {
        knownElementOffset += ETScriptStickyStore.getElementProp('wpAdminBar', 'height', 0);
      }

      if (isBottomPosition && isLBP && 600 <= ETScriptWindowStore.width && ETScriptStickyStore.getElementProp('wpAdminBar', 'exist', false)) {
        knownElementOffset += ETScriptStickyStore.getElementProp('wpAdminBar', 'height', 0);
      }

      // Responsive View'control in VB's responsive mode creates additional offset to be considered.
      if (ETScriptStickyStore.getElementProp('builderAppFramePaddingTop', 'exist', false)) {
        const appFramePaddingTop = ETScriptStickyStore.getElementProp('builderAppFramePaddingTop', 'height', 0);

        if (isTopPosition && isBFB) {
          knownElementOffset -= appFramePaddingTop;
        }

        if (isBottomPosition && isBuilder) {
          knownElementOffset += appFramePaddingTop;
        }
      }

      // Include Divi fixed secondary nav height into offset calculation if it exist
      if (isTopPosition && offsetModules && ETScriptStickyStore.getElementProp('diviFixedSecondaryNav', 'exist', false)) {
        knownElementOffset += ETScriptStickyStore.getElementProp('diviFixedSecondaryNav', 'height', 0);
      }

      // Include Divi fixed primary nav height into offset calculation if it exist
      const themeFixedHeaderName =  this.getThemeFixedPrimaryNavName();

      if (isTopPosition && offsetModules && ETScriptStickyStore.getElementProp(themeFixedHeaderName, 'exist', false)) {
        const themeFixedPrimaryNavHeight = ETScriptStickyStore.getElementProp(themeFixedHeaderName, 'height', 0);

        knownElementOffset += themeFixedPrimaryNavHeight;

        // Save currently used Divi fixed nav height on prop so it can be used later for reference
        this.setProp('themeFixedPrimaryNavHeight', themeFixedPrimaryNavHeight);
      }

      // If fixed primary nav `exist` prop doesn't exist at sticky store but its `height` prop
      // is not `0` locally on ETScriptStickyElement's prop it means primary nav previously exist as
      // fixed nav but now the breakpoint changes and it is no longer has fixed positioning; it
      // sits on top of the page instead (eg. at VB tablet mode). Update local prop to avoid
      // incorrect compariosn which causes bottom limit to break
      if (! ETScriptStickyStore.getElementProp(themeFixedHeaderName, 'exist', false) && 0 !== this.getProp('themeFixedPrimaryNavHeight')) {
        this.setProp('themeFixedPrimaryNavHeight', 0);
      }

      // Calculate Theme Builder's header which affect bottom positioning
      if (isBottomPosition && ETScriptStickyStore.getElementProp('tbHeader', 'exist', false)) {
        knownElementOffset += ETScriptStickyStore.getElementProp('tbHeader', 'height', 0);
      }

      // Calculate Layout Block Builder's header which affect bottom positioning
      if (isBottomPosition && ETScriptStickyStore.getElementProp('lbbHeader', 'exist', false)) {
        knownElementOffset += ETScriptStickyStore.getElementProp('lbbHeader', 'height', 0);
      }

      // Calculate Gutenberg Header
      if (isBottomPosition && isLBP && ETScriptStickyStore.getElementProp('gbHeader', 'exist', false)) {
        knownElementOffset += ETScriptStickyStore.getElementProp('gbHeader', 'height', 0);
      }

      // Calculate Gutenberg Footer (WordPress 5.4+)
      if (isBottomPosition && isLBP && ETScriptStickyStore.getElementProp('gbFooter', 'exist', false)) {
        knownElementOffset += ETScriptStickyStore.getElementProp('gbFooter', 'height', 0);
      }

      // Calculate notice list component
      if (isBottomPosition && isLBP && ETScriptStickyStore.getElementProp('gbComponentsNoticeList', 'exist', false)) {
        knownElementOffset += ETScriptStickyStore.getElementProp('gbComponentsNoticeList', 'height', 0);
      }
    }

    return customOffset + surroundingOffsetTop + knownElementOffset;
  }

  /**
   * Get formatted horizontal/vertical offset of relative position.
   *
   * @since 4.6.0
   *
   * @param {string} direction Vertical|horizontal.
   *
   * @returns {number}
   */
  getRelativePositionOffset = direction => {
    const relativeOrigin = this.getSetting('stickyStyles.position_origin_r');
    const originIndex    = 'vertical' === direction ? 0 : 1;
    const origin         = isString(relativeOrigin) ? relativeOrigin.split('_')[originIndex] : false;
    const offsetPx       = this.getPropertyValueInPx(`stickyStyles.${direction}_offset`);
    const multiplier     = {
      top: 1,
      bottom: - 1,
      left: 1,
      right: - 1,
    };

    if (origin && offsetPx) {
      return 0 + (offsetPx * get(multiplier, origin, 1));
    }

    return 0;
  }

  /**
   * Get current sticky element placeholder
   * Add identifieable data attribute and call it based on given data attribute.
   *
   * @since 4.6.0
   *
   * @returns {object} Jquery instance of placeholder.
   */
  getPlaceholder = () => $(`[data-sticky-placeholder-id="${this.getProp('id')}"]`)

  /**
   * Get property value in px. Some unit might cause unwanted rendering so it needs to be converted
   * into px (eg. Percentage unit uses viewport dimension as reference in fixed positioning
   * sticky state hence needs to be converted into px for it to correctly rendered).
   *
   * @param {string} settingName
   * @param {string|number} defaultValue
   *
   * @returns {number}
   */
  getPropertyValueInPx = (settingName, defaultValue = '') => {
    const value = this.getSetting(settingName);

    if (! isString(value) || includes(['none', 'auto'], value) || ! hasValue(value)) {
      return defaultValue;
    }

    if ('%' === value.substr(- 1)) {
      const parentWidth = this.getProp('$selector').parent().width();

      return getPercentage(parentWidth, value);
    }

    if ('vw' === value.substr(- 2)) {
      return getPercentage(ETScriptWindowStore.width, value);
    }

    if ('vh' === value.substr(- 2)) {
      return getPercentage(ETScriptWindowStore.height, value);
    }

    return parseFloat(value);
  }

  /**
   * Get sticky element's final `left` inline style. To accommodate smooth transitioning, some
   * sticky inline style need to have its non-sticky value at first then "final" sticky style
   * being added 50ms afterward. This is mostly needed due to transition from relative to fixed
   * positioning (which is relative to viewport) + transition.
   *
   * @since 4.6.0
   *
   * @returns {number\string}
   */
  getFinalInlineStyleLeft = () => {
    const moduleAlignment = this.getSetting('styles.module_alignment', '');

    let offsetLeft = get(this.getProp('offsets'), 'left', 0);

    // Pre-sticky state offset left is already correct sticky state offset for module alignment left.
    if (includes(['', 'left'], moduleAlignment)) {
      return offsetLeft;
    }

    // `left` property is building block of sticky element which is used to retain position of
    // module when entering sticky state. Thus `position: relative`'s horizontal offset which
    // modifies `left` needs to intentionally modifies inline final `left` of sticky module
    if (this.getSetting('stickyStyles.position_origin_r')) {
      // Add / subtract offset left based on retrieved `position: relative` horizontal offset
      offsetLeft += this.getRelativePositionOffset('horizontal');
    }

    // width property is affected by max-width property; smaller max-width means max-width will be
    // used instead of width value
    const width            = this.getProp('width');
    const stickyWidthPx    = this.getPropertyValueInPx('stickyStyles.width', this.getPropertyValueInPx('styles.width', ''));
    const renderedMaxWidth = parseFloat(this.getProp('$selector').css('maxWidth'));
    const stickyMaxWidthPx = this.getPropertyValueInPx('stickyStyles.max-width', this.getPropertyValueInPx('styles.max-width', isNaN(renderedMaxWidth) ? '' : renderedMaxWidth));

    const usedWidthProperty = () => {
      if (hasValue(stickyWidthPx) && ! hasValue(stickyMaxWidthPx)) {
        return 'width';
      }

      if (! hasValue(stickyWidthPx) && hasValue(stickyMaxWidthPx)) {
        return 'max-width';
      }

      return stickyWidthPx > stickyMaxWidthPx ? 'max-width' : 'width';
    };

    // If max-width is picked css property because no width value is set, compare its width with
    // existing width prop to ensure that max-width is smaller than width; otherwise just use
    // current width property
    if ('max-width' === usedWidthProperty() && ! hasValue(stickyWidthPx) && width < stickyMaxWidthPx) {
      return offsetLeft;
    }

    const stickyStyleWidthDefault = 'max-width' === usedWidthProperty() ? stickyMaxWidthPx : stickyWidthPx;
    const stickyStyleWidth        = this.getSetting(`stickyStyles.${usedWidthProperty()}`, this.getSetting(`styles.${usedWidthProperty()}`, stickyStyleWidthDefault));

    // Get sticky style left offset if module width in sticky state is different.
    // Module align center additional offset: 50% of width difference between pre and sticky state width.
    // Module align right additional offset: 100% of width difference between pre and sticky state width.
    const leftOffsetDivider = 'center' === moduleAlignment ? 2 : 1;

    if (isString(stickyStyleWidth) && hasValue(stickyStyleWidth)) {
      if ('%' === stickyStyleWidth.substr(- 1)) {
        const parentWidth = this.getProp('$selector').parent().width();

        return offsetLeft - ((getPercentage(parentWidth, stickyStyleWidth) - width) / leftOffsetDivider);
      }

      if ('vw' === stickyStyleWidth.substr(- 2)) {
        return offsetLeft - ((getPercentage(ETScriptWindowStore.width, stickyStyleWidth) - width) / leftOffsetDivider);
      }

      if ('vh' === stickyStyleWidth.substr(- 2)) {
        return offsetLeft - ((getPercentage(ETScriptWindowStore.height, stickyStyleWidth) - width) / leftOffsetDivider);
      }

      return offsetLeft - ((parseInt(stickyStyleWidth) - width) / leftOffsetDivider);
    }

    if (isNumber(stickyStyleWidth)) {
      return offsetLeft - ((stickyStyleWidth - width) / leftOffsetDivider);
    }

    return offsetLeft;
  }

  /**
   * Check if element is on sticky state
   * Top sticky state: `top` OR `top_bottom` element position + window scroll top which its value is lower
   * (visually higher) than element's default top offset
   * Bottom sticky state:`bottom` or `top_bottom` position + window scroll which its value is higher
   * (visually lower) than element's default bottom offset (top offset + element height).
   *
   * @since 4.6.0
   *
   * @param {string} position Top|Bottom.
   *
   * @returns {bool}
   */
  isStickyScroll = position => {
    const hasTopOrBottomPosition = this.isProp('position', position);
    const isPositionSticky       = this.isProp('topBottomPosition', position);

    return hasTopOrBottomPosition || (this.isProp('position', 'top_bottom') && isPositionSticky);
  }

  /**
   * Check if element will have sticky state on current event scroll. Element with `top` / `bottom`
   * position is pretty straightforward; `top_bottom` element requires further evaluetion since
   * it can be either `top` or `bottom` depending to current window scroll top position.
   *
   * @since 4.6.0
   * @param position
   * @param {*} side Top|Bottom.
   */
  willStickyScroll = position => {
    // Return early if it is either `top` / `bottom` position
    const hasTopOrBottomPosition = this.isProp('position', position);

    if (hasTopOrBottomPosition) {
      return true;
    }

    // Beside top / bottom evaluation, another valid position is `top_bottom`. Otherwise, return false
    if (! this.isProp('position', 'top_bottom')) {
      return false;
    }

    // Check top or bottom
    const isTop = 'top' === position;

    // Element dimension
    const stickyHeight    = this.getProp('height');
    const stickyOffsetTop = get(this.getProp('offsets'), 'top', 0);

    // Window attributes
    const windowScrollTop    = ETScriptWindowStore.scrollTop;
    const windowPositionEdge = isTop ? windowScrollTop + this.getOffset('top') : windowScrollTop + ETScriptWindowStore.height - this.getOffset('bottom');

    // Evaluate top / bottom Position, whether it is currently on top or bottom sticky state
    const isPositionSticky         = this.isProp('topBottomPosition', position);
    const willPositionSticky       = isTop ? windowPositionEdge >= stickyOffsetTop : windowPositionEdge < (stickyOffsetTop + stickyHeight);
    const willEndingPositionSticky = ! willPositionSticky && isPositionSticky;

    // Update is position sticky if it is changed;
    if (isPositionSticky !== willPositionSticky) {
      this.setProp('topBottomPosition', position);
    }

    // Is top_bottom is on scticky scroll position
    return willPositionSticky || willEndingPositionSticky;
  }

  /**
   * ET Window Scroll store's scroll event callback.
   *
   * @since 4.6.0
   */
  onWindowScroll = () => {
    // If current position is set to `none` in current breakpoint, do not process further
    // (this is possible when responsive is turned on; sticky is disabled in certain breakpoint)
    if (this.isProp('position', 'none')) {
      return;
    }

    const isAppWindowScroll = 'app' === ETScriptWindowStore.scrollLocation;
    const windowScrollTop   = ETScriptWindowStore.scrollTop;

    // Whether element is currently sticky / paused or not
    const isSticky = this.getProp('isSticky');
    const isPaused = this.getProp('isPaused');

    // Adjust sticky element positioning if Divi Theme's fixed height changes on window scroll
    // need to be used before any getOffset(); willStickyScroll() uses getOffset()
    if (isDiviTheme && (isFE || isVB) && isSticky && this.isStickyScroll('top')) {
      const savedThemeFixedHeaderHeight   = this.getProp('themeFixedPrimaryNavHeight', 0);
      const currentThemeFixedHeaderHeight = ETScriptStickyStore.getElementProp(this.getThemeFixedPrimaryNavName(), 'height', 0);

      // Check if used fixed nav height differs from current one which is fetched from store
      if (savedThemeFixedHeaderHeight !== currentThemeFixedHeaderHeight) {
        // This adjustment is adapted from startSticky(); adjust sticky element's top value
        const isScrollLocationApp = 'app' === ETScriptWindowStore.scrollLocation;
        const top                 = isScrollLocationApp ? 0 + this.getOffset('top') : ETScriptWindowStore.scrollTop + this.getOffset('top');

        this.getProp('$selector').css({
          top: `${top}px`,
        });
      }
    }

    // element's coordinates
    const pauseScrollTop = this.getProp('pauseScrollTop');

    // element's dimension
    const stickyHeight    = this.getProp('height');
    const stickyOffsetTop = get(this.getProp('offsets'), 'top', 0);

    // Top / bottom limit
    const bottomLimit = this.getProp('bottomLimitSettings');
    const topLimit    = this.getProp('topLimitSettings');

    // Check if element will enter sticky state on this scroll event or not
    const willTopStickyScroll    = this.willStickyScroll('top');
    const willBottomStickyScroll = this.willStickyScroll('bottom');

    // Whether element will be sticky or not; to be overwritten
    let willSticky = this.getProp('isSticky');
    let willPause  = this.getProp('isPaused');

    // Window top and bottom edges; Define the var on top of conditional so it can be used later
    let windowTopEdge    = 0;
    let windowBottomEdge = 0;

    // Determine whether element in current position qualified for sticky state or not
    // @todo scrollTop needs to be aware of manual and automatic offset
    if (willTopStickyScroll) {
      windowTopEdge = windowScrollTop + this.getOffset('top');

      // Sticky state active when window's top offset is greater (visually lower) than
      // sticky element's top offset
      willSticky = windowTopEdge > stickyOffsetTop;

      if (bottomLimit) {
        const bottomLimitOffsetBottom = get(bottomLimit, 'offsets.bottom', 0) - this.getOffset('bottom', 'surrounding');

        willPause = bottomLimitOffsetBottom <= (windowTopEdge + stickyHeight);
      }
    } else if (willBottomStickyScroll) {
      const windowHeightScale = ETScriptWindowStore.isBuilderZoomed ? 2 : 1;

      windowBottomEdge = windowScrollTop + (ETScriptWindowStore.height * windowHeightScale) - this.getOffset('bottom');

      // Sticky state active when window's bottom offset is smaller (visually higher) than
      // sticky element's bottom offset (sticky offset.top + height)
      willSticky = windowBottomEdge < (stickyOffsetTop + stickyHeight);

      if (topLimit) {
        const topLimitOffsetTop = get(topLimit, 'offsets.top', 0) + this.getOffset('top', 'surrounding');

        willPause = topLimitOffsetTop >= (windowBottomEdge - stickyHeight);
      }
    }

    // Activate sticky element
    if (willSticky && ! isSticky) {
      // Before actually start sticky state, check if the DOM is visible or not. Invisible DOM
      // (mostly caused on builder when module is dragged before dropped) will cause unexpected
      // positioning to the left of the page
      if (! this.getProp('$selector').is(':visible')) {
        // Reset the `willSticky`-ness to avoid unexpected behaviour
        willSticky = false;
      } else {
        // Module DOM is actually visible? Let the sticky begins
        this.startSticky();
      }
    }

    // Deactivate sticky element
    if (! willSticky && isSticky) {
      this.endSticky();
    }

    // Pause sticky state because it has reached limit
    if (willPause && ! isPaused && isAppWindowScroll) {
      this.pauseSticky();
    }

    // Resume sticky state because it returns from limit
    if (! willPause && isPaused && isAppWindowScroll) {
      this.resumeSticky();
    }

    if (willPause && false !== pauseScrollTop && isAppWindowScroll) {
      if (willTopStickyScroll && bottomLimit) {
        const pauseMarginTop = pauseScrollTop - windowScrollTop - this.getOffset('bottom', 'surrounding');

        setImportantInlineValue(this.getProp('$selector'), 'margin-top', `${pauseMarginTop}px`);
      } else if (willBottomStickyScroll && topLimit) {
        const pauseMarginBottom = windowScrollTop - pauseScrollTop - this.getOffset('top', 'surrounding');

        setImportantInlineValue(this.getProp('$selector'), 'margin-bottom', `${pauseMarginBottom}px`);
      }
    }

    // Update sticky state if stickiness state is changed
    if (willSticky !== isSticky) {
      this.setProp('isSticky', willSticky);
    }

    // Update pause state if pause state is changed
    if (willPause !== isPaused) {
      this.setProp('isPaused', willPause);
    }

    // Adjust scroll behaviour when scroll is on top window
    if (! isAppWindowScroll) {
      // Adjust the sticky position as the top window is scrolled
      if (willSticky && ! willPause) {
        if (this.isStickyScroll('top')) {
          this.getProp('$selector').css({
            top: `${windowTopEdge}px`, // equivalent to ETScriptWindowStore.scrollTop
          });
        }

        if (this.isStickyScroll('bottom')) {
          this.getProp('$selector').css({
            top: `${windowBottomEdge - stickyHeight}px`,
          });
        }
      }

      // Adjust sticky position when the scroll hits exactly paused offset
      if (willPause && ! isPaused) {
        if (this.isStickyScroll('top')) {
          // Essentially equivalent to bottomLimitOffsetBottom but it isn't always defined here
          const topWindowBottomLimitOffsetBottom = get(bottomLimit, 'offsets.bottom', 0) - this.getOffset('bottom', 'surrounding');

          this.getProp('$selector').css({
            top: `${topWindowBottomLimitOffsetBottom - stickyHeight}px`,
          });
        }

        if (this.isStickyScroll('bottom')) {
          // Essentially equivalent to topLimitOffsetTop but it isn't always defined here
          const topWindowTopLimitOffsetTop = get(topLimit, 'offsets.top', 0) + this.getOffset('top', 'surrounding');

          this.getProp('$selector').css({
            top: `${topWindowTopLimitOffsetTop}px`,
          });
        }
      }
    }
  }

  /**
   * Event listener callback which update props when scroll location is changed (builder only).
   *
   * @since 4.6.0
   */
  onWindowScrollLocationChange = debounce(() => {
    // What needs to be updated is identical to what happens on breakpoint change. Nevertheless
    // it needs to be delayed until builder preview mode animation change is completed hence
    // the debounce + trailing option
    this.onBreakpointChange();
  }, 2000, {
    leading: false,
    trailing: true,
  })

  /**
   * Event listener callback to Update sticky props and element attribute when
   * window width is changed.
   *
   * @since 4.6.0
   */
  onWindowWidthChange = debounce(() => {
    // Update states so next time module enter sticky state it'll use correct value
    this.setInitialProps();

    const isSticky = this.getProp('isSticky');

    // If module is currently in sticky state, update style properties right away
    if (isSticky) {
      this.updateInlineStyles();
    }
  }, 50, {
    trailing: true,
  })

  /**
   * Event listener callback to Update sticky props and element attribute when
   * window height is changed.
   *
   * @since 4.6.0
   */
  onWindowHeightChange = debounce(() => {
    // If window height is changed, paused sticky needs to be updated
    if (this.getProp('isPaused')) {
      this.pauseSticky();
    }
  }, 50);

  /**
   * Event listener callback to update sticky props when document height / width is changed
   * eg. Toggle module is expanded which makes document taller than before.
   *
   * @since 4.6.0
   */
  onDocumentDimensionChange = debounce(() => {
    // Update sticky element and its limits' offsets; If what changes document height happened on top
    // of element, existing offset values are no longer accurate; update it.
    this.setInitialProps(true);

    // Update module's width and left properties (offset) if current element is in sticky state
    if (this.getProp('isSticky')) {
      this.updateInlineStyles();
    }

    // Re-paused sticky / re-render styles for paused element to ensure the element is stopped
    // in correct limits
    if (this.getProp('isPaused')) {
      this.pauseSticky();
    }

    // Trigger window scroll event callback to immediately re-apply sticky limit inline style which
    // is possibly reset after this callback
    this.onWindowScroll();
  }, 50, {
    trailing: true,
  })

  /**
   * Event listener callback to update sticky props when breakpoint is changed so responsive
   * options can be rendered correctly.
   *
   * @since 4.6.0
   */
  onBreakpointChange = () => {
    const prevProps = {
      ...this.props,
    };

    const wasPositionNone = 'none' === get(prevProps, 'position');

    // End sticky to remove all inline styles and placeholder
    if (! wasPositionNone) {
      this.endSticky();
      this.setProp('isSticky', false);
    }

    // Re-set props using correct breakpoint value
    this.setInitialProps();

    const position       = this.getProp('position');
    const isPositionNone = 'none' === position;

    // New breakpoint set position to none
    if (isPositionNone && ! wasPositionNone) {
      return;
    }

    // Trigger on window scroll callback so startSticky can be called if current scroll position
    // after breakpoint change is still in sticky state
    this.onWindowScroll();
  }

  /**
   * Event listener callback when DOM of Sticky Element change. It needs to be observed because
   * element dimension might change (which affect offset calculation) but it doesn't modify
   * window and document height.
   *
   * @since 4.6.0
   */
  onDomChange = debounce((mutationList, observer) => {
    const height = parseFloat(this.getProp('$selector').outerHeight());
    const width  = parseFloat(this.getProp('$selector').outerWidth());
    const suffix = this.getProp('isSticky') ? 'Sticky' : '';

    if (! isNaN(width) && width !== this.getProp(`width${suffix}`)) {
      this.setProp(`width${suffix}`, width);
    }

    if (! isNaN(height) && height !== this.getProp(`height${suffix}`)) {
      this.setProp(`height${suffix}`, height);
    }
  }, 500)

  /**
   * Update initial props when Divi fixed header transition ends.
   *
   * @since 4.6.0
   *
   * @param {object} event
   */
  onDiviFixedHeaderTransitionEnd = event => {
    // If current sticky module is in sticky state + already hits its limit (paused), Divi fixed
    // header transition which apparently also modifies negative margin-top at #page-container
    // will affect paused sticky module position. To fix it, update limit offset value by
    // Re-populate initial props (kinda like how props are re-initialized after breakpoint change )
    if (this.getProp('isSticky') && this.getProp('isPaused')) {
      // End sticky to remove all inline styles and placeholder
      this.endSticky();
      this.setProp('isSticky', false);

      // Re-initialized props
      this.setInitialProps();

      // Trigger window scroll callback
      setTimeout(() => {
        this.onWindowScroll();
      }, 0);
    }
  }

  /**
   * Toggle has sticky classname at affecting parents. This is needed because to make sticky
   * element rendered on top of other element despite default stacking order.
   *
   * @since 4.6.0
   * @param status
   * @param {bool}
   */
  toggleAffectingParentsClassname = status => {
    const $builderWrapper  = this.getProp('$selector').closest('.et_builder_inner_content');
    const $column          = this.getProp('$selector').parents('.et_pb_column');
    const wrapperClassname = 'has_et_pb_sticky';

    if (status) {
      // Add has sticky classname. addClass won't double add classname so this would be fine
      $builderWrapper.addClass(wrapperClassname);

      if ($column.length > 0) {
        $column.addClass(wrapperClassname);
      }
    } else {
      // Only remove builder wrapper's has sticky classname IF there are no active sticky element
      // on current builder wrapper
      if ($builderWrapper.find('.et_pb_sticky').length < 1) {
        $builderWrapper.removeClass(wrapperClassname);
      }

      // Only remove column's has sticky classname IF there are no active sticky element
      // on current column
      if ($column.length > 0 && $column.find('.et_pb_sticky').length < 1) {
        $column.removeClass(wrapperClassname);
      }
    }
  }

  /**
   * Set style to activate sticky state on current element.
   *
   * @since 4.6.0
   */
  startSticky = () => {
    const isScrollLocationApp = 'app' === ETScriptWindowStore.scrollLocation;
    const dataAddress         = hasValue(this.getProp('$selector').attr('data-address')) ? `placeholder-${this.getProp('$selector').attr('data-address')}` : null;

    // Clone original module as placeholder, add classname so it can easily excluded, then
    // insert it on module's original location to avoid jiggling layout when module enters /
    // leaves sticky state. This also serves to retrieve updated style property when window
    // dimension is changed (previously use empty placeholder with dynamic value but JS
    // can't only computed style - this behaves poorly on module which uses percentage based
    // width and margin auto such as row).
    const $placeholder = this.getProp('$selector').clone().addClass('et_pb_sticky_placeholder').attr({
      'data-sticky-placeholder-id': this.getProp('id'),

      // data-address is used as reference for drag and drop in VB thus it should be unique
      'data-address': dataAddress,
    })
      .css({
        position: '',
        top: '',
        left: '',
        bottom: '',
        zIndex: '',
        width: '',
        marginTop: '',
        marginRight: '',
        marginBottom: '',
        marginLeft: '',
        padding: '',
      });

    // Remove all VB's custom CSS inside placeholder so it won't overwrite actual module's
    // style if it is being modified while module is in sticky state; placeholder only need
    // the HTML markup to hold the layout's position (since it has all the actual module's
    // classname which makes it has the same styling) when module entire sticky state
    $placeholder.find('.et-fb-custom-css-output').remove();

    // Remove on-page helper style
    $placeholder.find('.et_pb_sticky_module_style').remove();

    // Lock sticky module's parent when the module enters sticky state. There's a ms of time gap
    // between placeholder being added and sticky module being fixed positioning which could cause
    // the layout to jump. This is generally invisible but become very visible in BFB. The solution,
    // is to get sticky module parent's height, lock its height using !important tag, then remove
    // the height lock a milisecond after placeholder is added and sticky enter sticky state
    this.lockParentHeight();

    this.getProp('$selector').after($placeholder);

    // Placeholder height doesn't match to its actual selector height most likely means image inside
    // placeholder isn't fully loaded due to slow connection. Compensate this by adding fixed height
    // and width on image inside placeholder
    if ($placeholder.height() !== this.getProp('$selector').height()) {
      const $stickyModule = this.getProp('$selector');

      $placeholder.find('img').each(function(imageIndex) {
        const imageHeight = $stickyModule.find(`img:nth(${imageIndex})`).height();
        const imageWidth = $stickyModule.find(`img:nth(${imageIndex})`).width();
        const imageInlineStyle = {
          'height': `${imageHeight}px`,
          'width': `${imageWidth}px`,
        };

        // Remove inline fixed height style once the image is loaded
        $(this).css(imageInlineStyle).on('load', function() {
          $(this).css({
            height: '',
            width: '',
          });
        });
      });
    }

    // Add sticky element classnames; This is needed for child element's sticky style
    this.getProp('$selector').addClass(`et_pb_sticky et_pb_sticky--${this.getProp('position')}`);

    // Dispatch custom event which frontend script can listen and react to
    window.dispatchEvent(new CustomEvent('ETBuilderStickyStart', {
      detail: {
        stickyId: this.getProp('id'),
      },
    }));

    // Add classname to builder wrapper to temporarily change its stacking order
    this.toggleAffectingParentsClassname(true);

    // Get dynamically adjusted z-index value for sticky module
    const stickyZindex = () => {
      // Set higher z-index for sticky element on TB header because it always need to be stacked
      // on top of other sticky from different TB template.
      if (this.getProp('isInsideTbHeader')) {
        return 10010;
      }

      // Set lower z-index for sticky element on TB footer because it always need to be stacked
      // below other sticky from different TB template.
      if (this.getProp('isInsideTbFooter')) {
        return 9990;
      }

      return 10000;
    };

    // Set inline styles that activate sticky element
    // NOTE: position:fixed; is initially defined on `stickyStyles` using `css()` but position
    // opitions add `position: relative !important` by default so sticky elements need to use
    // much `position: fixed !important` via `css()`'s cssText` property
    const widthStickyStyle = this.getProp('widthSticky');
    const leftStickyStyle  = get(this.getProp('offsets'), 'left', 0);
    const stickyStyles     = {
      zIndex: stickyZindex(),
      width: isNumber(widthStickyStyle) ? `${widthStickyStyle}px` : widthStickyStyle,
      left: isNumber(leftStickyStyle) ? `${leftStickyStyle}px` : leftStickyStyle,
    };

    if (this.isStickyScroll('top')) {
      if (isScrollLocationApp) {
        stickyStyles.top = `${0 + this.getOffset('top')}px`;
      } else {
        stickyStyles.top            = `${ETScriptWindowStore.scrollTop + this.getOffset('top')}px`;
        stickyStyles['will-change'] = 'top';
      }

      // Ensures counter-side style;
      stickyStyles.bottom = 'auto';

      // Some element might have margin-bottom style; reset it;
      stickyStyles.marginTop = '0px';
    }

    if (this.isStickyScroll('bottom')) {
      if (isScrollLocationApp) {
        stickyStyles.bottom = `${0 + this.getOffset('bottom')}px`;
      } else {
        stickyStyles['will-change'] = 'top';
      }

      // Ensures counter-side style;
      stickyStyles.top = 'auto';

      // Some element might have margin-bottom style; reset it;
      stickyStyles.marginBottom = '0px';
    }

    // Determine if `position: relative` is set by builder by checking the value of
    // position relative's origin attribute
    const stickyRelativeOrigin = this.getSetting('stickyStyles.position_origin_r');
    const cssTransitions       = this.getProp('$selector').css('transition');

    // Remove `position: relative` offset's transition from transition property declaration by
    // overwriting it with trimmed transition declaration. This is needed to avoid unwanted
    // animation because when module enter sticky state, its position change to fixed which
    // makes the x,y axis moves from its parent to viewport. This transition will later be
    // re-executed by removing the inline `transition` style
    if (stickyRelativeOrigin && 'on' === this.getSetting('transition')) {
      stickyStyles.transition = trimTransitionValue(cssTransitions, ['top', 'right', 'bottom', 'left']);
    }

    // Position on sticky start
    let cssText = `position: fixed !important; padding: ${this.getProp('paddingSticky')} !important;`;

    // Set margin difference as inline style; margin in sticky style can't be simply used because
    // of the position value changed from relative to fixed when entering sticky state
    const marginRight       = this.getProp('marginRight');
    const marginLeft        = this.getProp('marginLeft');
    const marginRightSticky = this.getProp('marginRightSticky');
    const marginLeftSticky  = this.getProp('marginLeftSticky');

    if (0 !== marginRightSticky || 0 !== marginRight) {
      cssText += ` margin-right: ${marginRightSticky}px !important;`;
    }

    if (0 !== marginLeftSticky || 0 !== marginLeft) {
      cssText += ` margin-left: ${marginLeftSticky}px !important;`;
    }

    // Set inline style for sticky element
    this.getProp('$selector').css({ cssText }).css(stickyStyles);

    // Remove sticky module parent height lock; Ensure removal to be performed after sticky module
    // enters sticky state by setting it up after one milisecond of timeout
    setTimeout(() => {
      this.unlockParentHeight();
    }, 1);

    // Sticky style of css property that is used to construct sticky element need to be applied
    // after sticky element is constructed to ensure transition is correctly applied since
    // transition need initial and final property; otherwise it'll cause style jump with no transition
    const stickyStyleWidth    = this.getPropertyValueInPx('stickyStyles.width', this.getPropertyValueInPx('styles.width', ''));
    const stickyStyleMaxWidth = this.getPropertyValueInPx('stickyStyles.max-width');

    if (hasValue(stickyStyleWidth) || hasValue(stickyStyleMaxWidth) || stickyRelativeOrigin) {
      this.startStickyFinalStyleTimeout = setTimeout(() => {
        const finalStickyStyle     = {};
        const finalStickyStyleLeft = this.getFinalInlineStyleLeft();

        // Append final inline css property only if it returns valid value
        if (isNumber(finalStickyStyleLeft)) {
          finalStickyStyle.left = `${finalStickyStyleLeft}px`;
        }

        if (hasValue(stickyStyleWidth)) {
          finalStickyStyle.width = isNumber(stickyStyleWidth) ? `${stickyStyleWidth}px` : stickyStyleWidth;
        }

        if (hasValue(stickyStyleMaxWidth)) {
          finalStickyStyle['max-width'] = isNumber(stickyStyleMaxWidth) ? `${stickyStyleMaxWidth}px` : stickyStyleMaxWidth;
        }

        // Remove modified transition on final sticky styles
        if (stickyStyles.transition) {
          if ('top' === ETScriptWindowStore.scrollLocation) {
            // top transition should remain removed when scroll location is on top window because
            // sticky element on top relies to `top` being updated as top window is scrolled
            finalStickyStyle.transition = trimTransitionValue(cssTransitions, ['top']);
          } else {
            finalStickyStyle.transition = '';
          }
        }

        // `top` and `bottom` is building block of sticky element which is used to retain position
        // of module when entering sticky state. Thus `position: relative`'s vertical offset which
        // affects `top` and `bottom` needs to be intentionally modifies final `top` and `left`
        // property on the inline style
        if (stickyRelativeOrigin) {
          const relativePositionVerticalOffset = this.getRelativePositionOffset('vertical');

          if (isNumber(stickyStyles.top)) {
            finalStickyStyle.top = `${stickyStyles.top + relativePositionVerticalOffset}px`;
          }

          if (isNumber(stickyStyles.bottom)) {
            finalStickyStyle.bottom = `${stickyStyles.bottom + relativePositionVerticalOffset}px`;
          }
        }

        this.getProp('$selector').css(finalStickyStyle);
      }, 50);
    }

    // Toggle background-layout classname of current module and/or its child modules
    toggleAllBackgroundLayoutClassnameOnSticky(this.getProp('$selector'), true);
  }

  /**
   * Set properties and inline styling that activate pause mode. Pause is invoked when sticky
   * element moves passed its limit.
   *
   * @since 4.6.0
   */
  pauseSticky = () => {
    const topLimit     = this.getProp('topLimitSettings');
    const bottomLimit  = this.getProp('bottomLimitSettings');
    const pauseStyle   = {};
    const heightSticky = this.getProp('heightSticky');

    if (this.isStickyScroll('bottom') && topLimit) {
      // this.getProp('pauseScrollTop') is essentially equivalent to ETScriptWindowStore.scrollTop value
      // when the limit is passed. However it can't be used because pause might be called when
      // page load before any scroll event performed. Thus, manually calculate equivalent of window
      // scrollTop location when limit is passed
      this.setProp('pauseScrollTop', get(topLimit, 'offsets.top', 0) - (ETScriptWindowStore.height - (heightSticky + this.getOffset('bottom'))));

      const marginBottom = ETScriptWindowStore.scrollTop - this.getProp('pauseScrollTop') - this.getOffset('top', 'surrounding');

      // Set sticky margin style as important
      setImportantInlineValue(this.getProp('$selector'), 'margin-bottom', `${marginBottom}px`);
    } else if (this.isStickyScroll('top') && bottomLimit) {
      // this.getProp('pauseScrollTop') is essentially equivalent to ETScriptWindowStore.scrollTop value
      // when the limit is passed. However it can't be used because pause might be called when
      // page load before any scroll event performed. Thus, manually calculate equivalent of window
      // scrollTop location when limit is passed
      this.setProp('pauseScrollTop', get(bottomLimit, 'offsets.bottom', 0) - (heightSticky + this.getOffset('top')));

      const marginTop = ETScriptWindowStore.scrollTop - this.getProp('pauseScrollTop') + this.getOffset('bottom', 'surrounding');

      // Set sticky margin style as important
      setImportantInlineValue(this.getProp('$selector'), 'margin-top', `${marginTop}px`);
    }
  }

  /**
   * Unset properties and inline styling which deactivate pause mode. Resume is performed when
   * paused sticky element is scrolled back from its limit.
   *
   * @since 4.6.0
   */
  resumeSticky = () => {
    const topLimit    = this.getProp('topLimitSettings');
    const bottomLimit = this.getProp('bottomLimitSettings');
    const resumeStyle = {};

    if (this.isStickyScroll('bottom') && topLimit) {
      resumeStyle.marginBottom = '0px';
    } else if (this.isStickyScroll('top') && bottomLimit) {
      resumeStyle.marginTop = '0px';
    }

    this.setProp('pauseScrollTop', false);

    this.getProp('$selector').css(resumeStyle);
  }

  /**
   * End sticky state.
   *
   * @since 4.6.0
   */
  endSticky = () => {
    // Lock parent heigth because sticky style with transition which modifies module's height takes
    // ms to be fully completed; This gap, if the sticky module is the only module of its parent,
    // potentially causes the parent height to grow for miliseconds before it shrink back
    this.lockParentHeight();

    this.getPlaceholder().remove();

    // Remove sticky element classnames
    if (! this.getProp('$selector').hasClass('et_pb_sticky--editing')) {
      this.getProp('$selector').removeClass(`et_pb_sticky et_pb_sticky--${this.getProp('position')}`);
    }

    // Clear stickyStart timeout to avoid inline style being added after exiting sticky state
    clearTimeout(this.startStickyFinalStyleTimeout);

    // Remove classname to builder wrapper to reset its stacking order
    this.toggleAffectingParentsClassname(false);

    // Dispatch custom event which frontend script can listen and react to
    window.dispatchEvent(new CustomEvent('ETBuilderStickyEnd', {
      detail: {
        stickyId: this.getProp('id'),
      },
    }));

    // Style to remove inline sticky style
    const stickyStyles = {
      position: '',
      top: '',
      left: '',
      bottom: '',
      zIndex: '',
      width: '',
      marginTop: '',
      marginRight: '',
      marginBottom: '',
      marginLeft: '',
      'max-width': '',
      'will-change': '',
      padding: '',
    };

    // Inline style to be added when module transition is completed
    const finalStickyStyles = {};

    // Modify sticky styles and prepare for final sticky styles if current module uses position: relative
    const stickyRelativeOrigin = this.getSetting('stickyStyles.position_origin_r');

    if (stickyRelativeOrigin) {
      const originVertical      = isString(stickyRelativeOrigin) ? stickyRelativeOrigin.split('_')[0] : false;
      const originHorizontal    = isString(stickyRelativeOrigin) ? stickyRelativeOrigin.split('_')[1] : false;
      const verticalOffset      = this.getPropertyValueInPx('stickyStyles.vertical_offset');
      const horizontalOffset    = this.getPropertyValueInPx('stickyStyles.horizontal_offset');
      const hasVerticalOffset   = hasValue(verticalOffset);
      const hasHorizontalOffset = hasValue(horizontalOffset);

      // Only if there's value to avoid jumping layout when exiting sticky state.
      // Immediately reset inline style that is added during endSticky.
      if (hasVerticalOffset) {
        stickyStyles[originVertical]      = isNumber(verticalOffset) ? `${verticalOffset}px` : verticalOffset;
        finalStickyStyles[originVertical] = '';
      }

      if (hasHorizontalOffset) {
        stickyStyles[originHorizontal]      = isNumber(horizontalOffset) ? `${horizontalOffset}px` : horizontalOffset;
        finalStickyStyles[originHorizontal] = '';
      }

      if (hasVerticalOffset || hasHorizontalOffset) {
        // Remove `position: relative` offset related property (`top`, `right`, `bottom`, `left`)
        // from transition declaration to ensure smooth transition
        stickyStyles.transition = trimTransitionValue(this.getProp('$selector').css('transition'), ['top', 'right', 'bottom', 'left']);

        // Reset inline style that is added during endSticky
        finalStickyStyles.transition = '';
      }
    }

    // Unset inline styles which deactivates sticky element
    this.getProp('$selector').css(stickyStyles);

    // Toggle background-layout classname of current module and/or its child modules
    toggleAllBackgroundLayoutClassnameOnSticky(this.getProp('$selector'), false);

    // Get timeout value based on module's transition-duration style
    let transitionDuration = parseFloat(this.getProp('$selector').css('transition-duration')) * 1000;

    if (! isNumber(transitionDuration)) {
      transitionDuration = 0;
    }

    clearTimeout(this.endStickyUnlockParentTimeout);

    this.endStickyUnlockParentTimeout = setTimeout(() => {
      this.unlockParentHeight();

      // Apply final sticky styles
      if (! isEmpty(finalStickyStyles)) {
        this.getProp('$selector').css(finalStickyStyles);
      }

      // Reinitialized props if needed
      if (this.resetInitialPropsOnStickyEnd) {
        this.setInitialProps();

        this.resetInitialPropsOnStickyEnd = false;
      }
    }, transitionDuration);
  }

  /**
   * Set fixed height for sticky module parent to avoid jump when sticky module is transitioned
   * from / to sticky style.
   *
   * @since 4.6.0
   */
  lockParentHeight = () => {
    const $parent         = this.getProp('$selector').parent();
    const $grandParent    = $parent.parent();
    const prefixClass     = $grandParent.is('.et-l') ? `.${$grandParent.attr('class').replace(/ /g, '.')} ` : '';
    const classBlocklist  = ['has_et_pb_sticky', ''];
    const classRaw        = $parent.attr('class');
    const classList       = classRaw ? classRaw.split(' ') : [];
    const classFiltered   = filter(classList, className => ! includes(classBlocklist, className));
    const className       = `${prefixClass}.${classFiltered.join('.')}`;
    const parentHeight    = $parent.outerHeight();
    const lockDeclaration = `${className} {height: ${parentHeight}px !important;}`;
    const $heightLock     = $(`<style class="${this.lockStyleClassname}">${lockDeclaration}</style>`);

    // Start by unlocking existing (if there's any) to avoid duplicated lockHeight style
    this.unlockParentHeight();

    this.getProp('$selector').append($heightLock);
  }

  /**
   * Remove on-page <style> that is added to lock sticky module's parent's height.
   *
   * @since 4.6.0
   */
  unlockParentHeight = () => {
    this.getProp('$selector').find(`.${this.lockStyleClassname}`).remove();
  }
}

export default ETScriptStickyElement;
