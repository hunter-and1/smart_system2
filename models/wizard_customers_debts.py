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


class PrintCustomersDebts(models.TransientModel):
    _name = "wizard.customers.debts"

    @api.multi
    def print_customers_debts(self):
        data = self.read()[0]
        datas = {
            'ids': self._ids,
            'model': 'wizard.customers.debts',
            'form': data,
        }
        return self.env['report']\
            .get_action(self, 'smart_system2.report_customers_debts_template', data=datas)

    def get_customers(self):
        fields = ['name', 'debt']
        domain = [('customer', '=', True)]
        partner_obj = self.env['res.partner'].search_read(domain=domain,
                fields=fields)
        result = []
        for i in partner_obj:
            if i.get('debt') > 0:
                result.append(i)
        if result:
            return result
        return False


class smart_system2_report_customers_debts_template(models.AbstractModel):
    _name = "report.smart_system2.report_customers_debts_template"

    @api.model
    def render_html(self, docids, data=None):

        report_obj = self.env['report']
        report = report_obj._get_report_from_name('smart_system2.report_customers_debts_template')
        docargs = {
            'doc_ids': self.env["wizard.customers.debts"].search([('id', 'in', list(data["ids"]))]),
            'doc_model': report.model,
            'data': data,
            'docs': self,
        }
        return self.env['report'].render('smart_system2.report_customers_debts_template', docargs)
# vim:expandtab:smartindent:tabstop=4:softtabstop=4:shiftwidth=4: