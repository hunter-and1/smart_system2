odoo.define('smart_system2.gui', function (require) {
"use strict";

	var models = require('point_of_sale.models');
    var core = require('web.core');
    var gui = require('point_of_sale.gui');
    var db = require('point_of_sale.DB');
    var utils = require('web.utils');

    var QWeb = core.qweb;
    var _t = core._t;

    gui.Gui.prototype.screen_classes.filter(function(el) { return el.name == 'clientlist';})[0].widget.include({
        init: function(parent, options){
            this._super(parent, options);
            this.round = function(value) {
                return Math.round(value * 100) / 100;
            };
            this.check_user_in_group = function(group_id, groups) {
                return  $.inArray(group_id, groups) != -1;
            };
            this.pos.on('updateDebtHistory', function(partner_ids){
                this.update_debt_history(partner_ids);
            }, this);
        },
        update_debt_history: function (partner_ids){
            var self = this;
            if (self.pos.config.enable_debit){
                if (this.new_client && $.inArray(this.new_client.id, partner_ids) != -1) {
                    var debt = this.pos.db.get_partner_by_id(this.new_client.id).debt;
                    if (this.new_client.debt_type == 'credit') {
                        debt = - debt;
                    }
                    debt = this.format_currency(debt);
                    $('.client-detail .detail.client-debt').text(debt);
                }
                _.each(partner_ids, function(id){
                    self.partner_cache.clear_node(id);
                });
                var customers = this.pos.db.get_partners_sorted(1000);
                this.render_list(customers);
            }
        },
        render_list: function(partners){
            var self = this;
            var debt_type = partners && partners.length ? partners[0].debt_type : '';
            if (debt_type == 'debt') {
                this.$('#client-list-credit').remove();
            } else if (debt_type == 'credit') {
                this.$('#client-list-debt').remove();
            }
            this._super(partners);
        },
        render_debt_history: function(partner){
            var self = this;
            if (self.pos.config.enable_debit){
                var contents = this.$el[0].querySelector('#debt_history_contents');
                contents.innerHTML = "";
                var debt_type = partner.debt_type;
                var debt_history = partner.history;
                var sign = debt_type == 'credit' ? -1 : 1;
                if (debt_history) {
                    var total_balance = partner.debt;
                    for (var i = 0; i < debt_history.length; i++) {
                        debt_history[i].total_balance = sign * Math.round(total_balance * 100) / 100;
                        total_balance += debt_history[i].balance;
                    }
                    for (var i = 0; i < debt_history.length; i++) {
                        var debt_history_line_html = QWeb.render('DebtHistoryLine', {
                            partner: partner,
                            line: debt_history[i]
                        });
                        var debt_history_line = document.createElement('tbody');
                        debt_history_line.innerHTML = debt_history_line_html;
                        debt_history_line = debt_history_line.childNodes[1];
                        contents.appendChild(debt_history_line);
                    }
                }
            }
        },
        toggle_save_button: function(){
            this._super();
            var self = this;
            if (self.pos.config.enable_debit){
                var $pay_full_debt = this.$('#set-customer-pay-full-debt');
                var $show_customers = this.$('#show_customers');
                var $show_debt_history = this.$('#show_debt_history');
                var $debt_history = this.$('#debt_history');
                var curr_client = this.pos.get_order().get_client();
                var client = this.new_client || curr_client;
                if (this.editing_client) {
                    $pay_full_debt.addClass('oe_hidden');
                    $show_debt_history.addClass('oe_hidden');
                    $show_customers.addClass('oe_hidden');
                } else {
                    if ((this.new_client && this.new_client.debt > 0) ||
                            (curr_client && curr_client.debt > 0 && !this.new_client)) {
                        $pay_full_debt.removeClass('oe_hidden');
                    }else{
                        $pay_full_debt.addClass('oe_hidden');
                    }
                    if (client) {
                        $show_debt_history.removeClass('oe_hidden');
                        $show_debt_history.on('click', function () {
                            var $loading_history = $('#loading_history');
                            $loading_history.removeClass('oe_hidden');
                            self.render_debt_history(client);
                            $('.client-list').addClass('oe_hidden');
                            $debt_history.removeClass('oe_hidden');
                            $show_debt_history.addClass('oe_hidden');
                            $show_customers.removeClass('oe_hidden');
                            // TODO add "Load more" button
                            var debt_history_limit = 10;
                            self.pos.reload_debts(
                                client.id,
                                debt_history_limit,
                                {"postpone": false}
                            ).then(
                                    function () {
                                        self.render_debt_history(client);
                                        $loading_history.addClass('oe_hidden');
                                    });
                        });
                    } else {
                        $show_debt_history.addClass('oe_hidden');
                        $show_debt_history.off();
                    }
                }
            }
        },

        show: function(){
            this._super();
            var self = this;
                if (self.pos.config.enable_debit){
                this.$('#set-customer-pay-full-debt').click(function(){
                    self.save_changes();
                    if (self && self.new_client && self.new_client.debt <= 0) {
                        self.gui.show_popup('error',{
                            'title': _t('Error: No Debt'),
                            'body': _t('The selected customer has no debt.'),
                        });
                        return;
                    }
                    // if the order is empty, add a dummy product with price = 0
                    var order = self.pos.get_order();
                    if (order) {
                        var lastorderline = order.get_last_orderline();
                        if (lastorderline === undefined && self.pos.config.debt_dummy_product_id){
                            var dummy_product = self.pos.db.get_product_by_id(
                                self.pos.config.debt_dummy_product_id[0]);
                            order.add_product(dummy_product, {'price': 0});
                        }
                    }
                    // select debt journal
                    var debtjournal = false;
                    _.each(self.pos.cashregisters, function(cashregister) {
                        if (cashregister.journal.debt) {
                            debtjournal = cashregister;
                        }
                    });

                    // add payment line with amount = debt *-1
                    var paymentLines = order.get_paymentlines();
                    if (paymentLines.length) {
                        /* Delete existing debt line
                        Usefull for the scenario where a customer comes to
                        pay his debt and the user clicks on the "Debt journal"
                        which opens the partner list and then selects partner
                        and clicks on "Select Customer and Pay Full Debt" */
                        _.each(paymentLines.models, function(paymentLine) {
                            if (paymentLine.cashregister.journal.debt){
                                paymentLine.destroy();
                            }
                        });
                    }

                    if(self && self.new_client){
                    	var newDebtPaymentline = new models.Paymentline({},{order: order, cashregister: debtjournal, pos: self.pos});
                        newDebtPaymentline.set_amount(self.new_client.debt * -1);
                        order.paymentlines.add(newDebtPaymentline);
                        self.gui.show_screen('payment');
                    }
                });
                var $show_customers = $('#show_customers');
                var $show_debt_history = $('#show_debt_history');
                if (this.pos.get_order().get_client() || this.new_client) {
                    $show_debt_history.removeClass('oe_hidden');
                }
                $show_customers.off().on('click', function () {
                    $('.client-list').removeClass('oe_hidden');
                    $('#debt_history').addClass('oe_hidden');
                    $show_customers.addClass('oe_hidden');
                    $show_debt_history.removeClass('oe_hidden');
                });
            }
        },
        saved_client_details: function(partner_id){
            var self = this;
            this.pos.gui.screen_instances.clientlist.partner_cache.clear_node(partner_id);
            this._super(partner_id);
        },
        reload_partners: function(){
        var self = this;
            return this._super().then(function () {
                self.render_list(self.pos.db.get_partners_sorted(1000));
            });
        }
    });
});