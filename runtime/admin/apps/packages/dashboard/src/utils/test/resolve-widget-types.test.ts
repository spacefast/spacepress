import { resolveWidgetTypes } from '../resolve-widget-types';
import type { RegisteredDashboardWidgetType } from '../../types';

const widget: RegisteredDashboardWidgetType = {
    name: 'registered/widget', render_module: '/registered/render',
    widget_module: './test/fixtures/widget',
};

describe('resolveWidgetTypes with real modules', () => {
    it('loads module metadata and honors cancellation', async () => {
        expect(await resolveWidgetTypes([widget])).toEqual([{
            name: 'local/widget', title: 'Loaded widget', render_module: '/local/render',
            example: { metric: 'count' },
        }]);
        const controller = new AbortController();
        controller.abort();
        expect(await resolveWidgetTypes([widget], { signal: controller.signal })).toEqual([]);
    });

    it('keeps successful modules when another import is invalid', async () => {
        const result = await resolveWidgetTypes([
            widget, { ...widget, widget_module: './test/fixtures/invalid' },
        ]);
        expect(result.map((entry) => entry.title)).toEqual(['Loaded widget']);
        expect(console).toHaveErrored();
    });
});
