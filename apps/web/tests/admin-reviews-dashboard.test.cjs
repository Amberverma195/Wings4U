const React = require('react');
const { act, create } = require('react-test-renderer');

global.IS_REACT_ACT_ENVIRONMENT = true;

const mockSession = {
  loaded: true,
  user: { id: 'admin-user', role: 'ADMIN' },
  refresh: jest.fn(),
  clear: jest.fn(),
};

jest.mock('@/lib/session', () => ({
  useSession: () => mockSession,
  withSilentRefresh: (call) => call(),
}));

jest.mock('../src/app/admin/admin-api', () => ({
  adminApiFetch: jest.fn(),
}));

const { adminApiFetch } = require('../src/app/admin/admin-api');
const { AdminReviewsClient } = require('../src/app/admin/reviews/reviews-client');

describe('Admin Reviews Dashboard Enrichment and Reply Audit', () => {
  let renderer;

  afterEach(async () => {
    if (renderer) {
      await act(async () => renderer.unmount());
      renderer = null;
    }
    jest.clearAllMocks();
  });

  const sampleReview = {
    id: 'rev-uuid-001',
    order_id: 'ord-uuid-001',
    order_item_id: 'item-uuid-001',
    customer_user_id: 'cust-uuid-001',
    rating: 5,
    review_body: 'Crispy skin, great sauce balance.',
    is_approved_public: false,
    admin_reply: null,
    admin_replied_at: null,
    admin_replied_by_user_id: null,
    created_at: '2026-10-21T18:00:00Z',
    updated_at: '2026-10-21T18:00:00Z',
    order_number: '1042',
    customer_name: 'Sarah Connor',
    customer_phone: '+15195550188',
    customer_email: 'sarah@example.com',
    item_name: '2lb Smoked Wings',
  };

  test('displays customer identity, contact info, order number, reviewed item, and publication status', async () => {
    adminApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          items: [sampleReview],
          next_cursor: null,
        },
      }),
    });

    await act(async () => {
      renderer = create(React.createElement(AdminReviewsClient));
    });

    const text = JSON.stringify(renderer.toJSON());

    // Verified Customer Identity
    expect(text).toContain('Sarah Connor');
    expect(text).toContain('+15195550188');
    expect(text).toContain('sarah@example.com');

    // Human-readable Order number and reviewed item
    expect(text).toContain('#1042');
    expect(text).toContain('2lb Smoked Wings');

    // Rating & comment
    expect(text).toContain('Crispy skin, great sauce balance.');

    // Publication status badge
    expect(text).toContain('Internal Only (Unpublished)');

    // Technical UUIDs are present in collapsible details
    expect(text).toContain('Technical IDs for troubleshooting');
    expect(text).toContain('ord-uuid-001');
    expect(text).toContain('item-uuid-001');
    expect(text).toContain('cust-uuid-001');
    expect(text).toContain('rev-uuid-001');

    // Reply button uses honest wording (does NOT claim to send email/SMS)
    expect(text).toContain('Save reply');
    expect(text).not.toContain('Send reply');

    // Check presence of publication policy and customer privacy safeguards banner
    expect(text).toContain('Publication Policy & Customer Privacy Safeguards');
    expect(text).toContain('Reviews are internal by default and never published automatically');
  });

  test('posting an admin reply updates review state and preserves customer enrichment', async () => {
    adminApiFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            items: [sampleReview],
            next_cursor: null,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            ...sampleReview,
            admin_reply: 'Thank you Sarah!',
            admin_replied_at: '2026-10-22T09:30:00Z',
            admin_replied_by_user_id: 'admin-user',
          },
        }),
      });

    await act(async () => {
      renderer = create(React.createElement(AdminReviewsClient));
    });

    // Enter reply text
    const textarea = renderer.root.findByType('textarea');
    await act(async () => {
      textarea.props.onChange({ target: { value: 'Thank you Sarah!' } });
    });

    // Click "Save reply" button
    const buttons = renderer.root.findAllByType('button');
    const saveReplyBtn = buttons.find((b) => {
      const c = Array.isArray(b.children) ? b.children.join('') : b.children;
      return c === 'Save reply';
    });
    expect(saveReplyBtn).toBeDefined();

    await act(async () => {
      saveReplyBtn.props.onClick();
    });

    expect(adminApiFetch).toHaveBeenCalledWith(
      '/api/v1/admin/reviews/rev-uuid-001/reply',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reply: 'Thank you Sarah!' }),
      }),
    );

    const updatedText = JSON.stringify(renderer.toJSON());
    expect(updatedText).toContain('Update reply');
    expect(updatedText).toContain('Sarah Connor');
    expect(updatedText).toContain('#1042');
  });

  test('publishing a review requires informed consent & privacy confirmation before calling API', async () => {
    adminApiFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            items: [sampleReview],
            next_cursor: null,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            ...sampleReview,
            is_approved_public: true,
          },
        }),
      });

    await act(async () => {
      renderer = create(React.createElement(AdminReviewsClient));
    });

    const publishBtn = renderer.root.findAllByType('button').find((b) => {
      const c = Array.isArray(b.children) ? b.children.join('') : b.children;
      return c === 'Publish';
    });
    expect(publishBtn).toBeDefined();

    // Clicking 'Publish' triggers the informed confirmation dialog
    await act(async () => {
      publishBtn.props.onClick();
    });

    const confirmText = JSON.stringify(renderer.toJSON());
    expect(confirmText).toContain('Verify Publication Permission & Privacy Check');
    expect(confirmText).toContain('Consent Verification');
    expect(confirmText).toContain('Privacy Check');
    expect(confirmText).toContain('Confirm & Publish');

    // API has NOT yet been called prior to explicit confirmation
    expect(adminApiFetch).not.toHaveBeenCalledWith(
      '/api/v1/admin/reviews/rev-uuid-001/publish',
      expect.anything(),
    );

    // Click 'Confirm & Publish'
    const confirmBtn = renderer.root.findAllByType('button').find((b) => {
      const c = Array.isArray(b.children) ? b.children.join('') : b.children;
      return c === 'Confirm & Publish';
    });
    expect(confirmBtn).toBeDefined();

    await act(async () => {
      confirmBtn.props.onClick();
    });

    expect(adminApiFetch).toHaveBeenCalledWith(
      '/api/v1/admin/reviews/rev-uuid-001/publish',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ publish: true }),
      }),
    );

    const updatedText = JSON.stringify(renderer.toJSON());
    expect(updatedText).toContain('Published Publicly');
    expect(updatedText).toContain('Unpublish');
  });
});
