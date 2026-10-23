const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { act, create } = require('react-test-renderer');

global.IS_REACT_ACT_ENVIRONMENT = true;

// Mock dependencies
jest.mock('@/lib/api', () => ({
  apiFetch: jest.fn(),
}));

jest.mock('@/lib/env', () => ({
  DEFAULT_LOCATION_ID: 'LON01',
}));

const { apiFetch } = require('@/lib/api');
const { TestimonialsSection } = require('../src/Wings4u/components/testimonials-section');
const { NewsletterSection } = require('../src/Wings4u/components/newsletter-section');
const { HeroNewsletterPromo } = require('../src/Wings4u/components/hero-newsletter-promo');

describe('Genuine Reviews and 15% Promotion Verification', () => {
  let renderer;
  let originalWindow, originalDocument;

  beforeEach(() => {
    originalWindow = global.window;
    originalDocument = global.document;
    const windowTarget = new EventTarget();
    windowTarget.matchMedia = jest.fn(() => ({ matches: false }));
    global.window = windowTarget;
    global.document = {
      getElementById: jest.fn(),
    };
  });

  afterEach(async () => {
    if (renderer) {
      await act(async () => renderer.unmount());
      renderer = null;
    }
    global.window = originalWindow;
    global.document = originalDocument;
    jest.clearAllMocks();
  });

  describe('Section 2: Complete removal of static fake reviews', () => {
    test('testimonials-section.tsx contains zero fake reviews, handles, or platform sources', () => {
      const source = fs.readFileSync(
        path.resolve(__dirname, '../src/Wings4u/components/testimonials-section.tsx'),
        'utf8',
      );

      const fakeEntities = [
        'Priya S.',
        'Marcus T.',
        'Aisha K.',
        'Jordan L.',
        'Sam R.',
        '@priya_foodie',
        '@marcus_eats',
        '@aisha.kitchen',
        '@jordo_wings',
        '@samreviewsfood',
        'Google',
        'Yelp',
        'UberEats',
      ];

      for (const entity of fakeEntities) {
        expect(source).not.toContain(entity);
      }
    });
  });

  describe('Section 3: Genuine review homepage integration and privacy', () => {
    test('gracefully hides review area (renders null) when zero reviews are approved', async () => {
      apiFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      });

      await act(async () => {
        renderer = create(React.createElement(TestimonialsSection));
      });

      expect(renderer.toJSON()).toBeNull();
    });

    test('gracefully hides review area when API request fails without exposing errors', async () => {
      apiFetch.mockRejectedValueOnce(new Error('Network connection timeout'));

      await act(async () => {
        renderer = create(React.createElement(TestimonialsSection));
      });

      expect(renderer.toJSON()).toBeNull();
    });

    test('renders a single genuine review without internal UUIDs, artificial duplication or tickerScroll', async () => {
      const singleReview = {
        rating: 5,
        comment: 'Best honey gold wings in London. Absolutely phenomenal crispiness.',
        item_name: 'Honey Gold Wings',
        attribution: 'Verified Wings4U Customer',
        created_at: '2026-10-20T14:30:00Z',
        admin_reply: 'Thank you for the wonderful feedback! See you again soon.',
        admin_replied_at: '2026-10-21T09:00:00Z',
      };

      apiFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [singleReview] }),
      });

      await act(async () => {
        renderer = create(React.createElement(TestimonialsSection));
      });

      const treeStr = JSON.stringify(renderer.toJSON());

      // Contains authentic content
      expect(treeStr).toContain('Best honey gold wings in London');
      expect(treeStr).toContain('Honey Gold Wings');
      expect(treeStr).toContain('Verified Wings4U Customer');
      expect(treeStr).toContain('Wings 4 U Replied');
      expect(treeStr).toContain('Thank you for the wonderful feedback');

      // Exactly ONE article rendered in testimonials-single-wrapper (no duplication, no tickerScroll)
      const articles = renderer.root.findAllByType('article');
      expect(articles).toHaveLength(1);
      expect(articles[0].props.className).toContain('tcard--single');
      expect(treeStr).toContain('testimonials-single-wrapper');
      expect(treeStr).not.toContain('tickerScroll');
      expect(treeStr).not.toContain('real-rev');

      // No fake third-party source badges or usernames
      expect(treeStr).not.toContain('Google');
      expect(treeStr).not.toContain('Yelp');
      expect(treeStr).not.toContain('@');
    });

    test('renders 2 reviews in a static responsive grid without tickerScroll', async () => {
      const reviews = [
        {
          rating: 5,
          comment: 'Incredible flavor on the cajun dry rub.',
          item_name: 'Cajun Dry Rub Wings',
          attribution: 'Verified Wings4U Customer',
          created_at: '2026-10-18T12:00:00Z',
          admin_reply: null,
          admin_replied_at: null,
        },
        {
          rating: 4,
          comment: 'Very fast delivery and hot food.',
          item_name: 'Buffalo Mild Wings',
          attribution: 'Verified Wings4U Customer',
          created_at: '2026-10-19T13:00:00Z',
          admin_reply: 'Glad to hear it arrived piping hot!',
          admin_replied_at: '2026-10-20T10:00:00Z',
        },
      ];

      apiFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: reviews }),
      });

      await act(async () => {
        renderer = create(React.createElement(TestimonialsSection));
      });

      const articles = renderer.root.findAllByType('article');
      expect(articles).toHaveLength(2);
      const treeStr = JSON.stringify(renderer.toJSON());
      expect(treeStr).toContain('testimonials-grid');
      expect(treeStr).not.toContain('testimonials-single-wrapper');
      expect(treeStr).not.toContain('tickerScroll');
    });

    test('renders 3 and multiple reviews in a static responsive grid without tickerScroll or blank void', async () => {
      const threeReviews = [
        { rating: 5, comment: 'Review 1', item_name: 'Item 1', attribution: 'Cust 1', created_at: '2026-10-01T00:00:00Z', admin_reply: null, admin_replied_at: null },
        { rating: 4, comment: 'Review 2', item_name: 'Item 2', attribution: 'Cust 2', created_at: '2026-10-02T00:00:00Z', admin_reply: null, admin_replied_at: null },
        { rating: 5, comment: 'Review 3', item_name: 'Item 3', attribution: 'Cust 3', created_at: '2026-10-03T00:00:00Z', admin_reply: null, admin_replied_at: null },
      ];

      apiFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: threeReviews }),
      });

      await act(async () => {
        renderer = create(React.createElement(TestimonialsSection));
      });

      const articles = renderer.root.findAllByType('article');
      expect(articles).toHaveLength(3);
      const treeStr = JSON.stringify(renderer.toJSON());
      expect(treeStr).toContain('testimonials-grid');
      expect(treeStr).not.toContain('tickerScroll');

      // Verify global styles have completely removed tickerScroll
      const globalCss = fs.readFileSync(
        path.resolve(__dirname, '../src/Wings4u/components/global-style.tsx'),
        'utf8',
      );
      expect(globalCss).not.toContain('tickerScroll');
      expect(globalCss).not.toContain('@keyframes tickerScroll');
    });
  });

  describe('Section 6: Preservation of 15% Promotion', () => {
    test('NewsletterSection renders 15% promotion independently with ORDER NOW button', async () => {
      let dispatched = false;
      const listener = () => {
        dispatched = true;
      };
      window.addEventListener('wings4u:open-order-method', listener);

      await act(async () => {
        renderer = create(React.createElement(NewsletterSection));
      });

      const treeStr = JSON.stringify(renderer.toJSON());
      expect(treeStr).toContain('STAY SAUCY');
      expect(treeStr).toContain('15% OFF');
      expect(treeStr).toContain('YOUR FIRST ORDER');

      const button = renderer.root.findByProps({ className: 'newsletter-btn newsletter-btn--order' });
      await act(async () => {
        button.props.onClick();
      });

      expect(dispatched).toBe(true);
      window.removeEventListener('wings4u:open-order-method', listener);
    });

    test('HeroNewsletterPromo scrolls to #newsletter and has corrected accessible label', async () => {
      const scrollIntoViewMock = jest.fn();
      global.document.getElementById = jest.fn((id) => {
        if (id === 'newsletter') {
          return { scrollIntoView: scrollIntoViewMock };
        }
        return null;
      });

      await act(async () => {
        renderer = create(React.createElement(HeroNewsletterPromo));
      });

      const button = renderer.root.findByType('button');
      expect(button.props['aria-label']).toBe('Get 15% off your first order - view promotion');
      expect(button.props['aria-label']).not.toContain('newsletter signup');

      await act(async () => {
        button.props.onClick();
      });

      expect(global.document.getElementById).toHaveBeenCalledWith('newsletter');
      expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    });

    test('WingKingsShell imports and renders NewsletterSection independently from TestimonialsSection', () => {
      const shellSource = fs.readFileSync(
        path.resolve(__dirname, '../src/components/wingkings-shell.tsx'),
        'utf8',
      );

      expect(shellSource).toContain('import { NewsletterSection } from "@/Wings4u/components/newsletter-section";');
      expect(shellSource).toContain('{showMarketingSections ? <TestimonialsSection /> : null}');
      expect(shellSource).toContain('{showMarketingSections ? <NewsletterSection /> : null}');
    });
  });
});
