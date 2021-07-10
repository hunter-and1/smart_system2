# -*- coding: utf-8 -*-
##############################################################################
#
#    OpenERP, Open Source Management Solution
#    Copyright (c) 2013-Present Acespritech Solutions Pvt. Ltd. (<http://acespritech.com>).
#
#    This program is free software: you can redistribute it and/or modify
#    it under the terms of the GNU Affero General Public License as
#    published by the Free Software Foundation, either version 3 of the
#    License, or (at your option) any later version.
#
#    This program is distributed in the hope that it will be useful,
#    but WITHOUT ANY WARRANTY; without even the implied warranty of
#    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
#    GNU Affero General Public License for more details.
#
#    You should have received a copy of the GNU Affero General Public License
#    along with this program.  If not, see <http://www.gnu.org/licenses/>.
#
##############################################################################

from odoo import models, fields, api, tools, _


class PrintDebtHistory(models.TransientModel):
    _name = "wizard.debt.history"

    partner_id = fields.Many2one('res.partner', 'Customer', required=True)
    start_date = fields.Date('Start Date')
    end_date = fields.Date('End Date')


    @api.multi
    def print_debt_history(self):
        data = self.read()[0]
        datas = {
            'ids': self._ids,
            'model': 'wizard.debt.history',
            'form': data,
        }
        return self.env['report']\
            .get_action(self, 'smart_system2.report_debt_history_template', data=datas)


class smart_system2_report_debt_history_template(models.AbstractModel):
    _name = "report.smart_system2.report_debt_history_template"

    @api.model
    def render_html(self, docids, data=None):

        report_obj = self.env['report']
        report = report_obj._get_report_from_name('smart_system2.report_debt_history_template')
        docargs = {
            'doc_ids': self.env["wizard.debt.history"].search([('id', 'in', list(data["ids"]))]),
            'doc_model': report.model,
            'data': data,
            'docs': self,
        }
        return self.env['report'].render('smart_system2.report_debt_history_template', docargs)
# vim:expandtab:smartindent:tabstop=4:softtabstop=4:shiftwidth=4: