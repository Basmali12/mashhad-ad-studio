#!/usr/bin/env bash
set -euo pipefail
# Applies only to the eight new browser OS identities. Existing owner/platform traffic is unchanged.
iptables -N MASHHAD_FLOW_CUSTOMER 2>/dev/null || iptables -S MASHHAD_FLOW_CUSTOMER >/dev/null
iptables -C MASHHAD_FLOW_CUSTOMER -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN 2>/dev/null || iptables -A MASHHAD_FLOW_CUSTOMER -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
for protocol in udp tcp; do
 iptables -C MASHHAD_FLOW_CUSTOMER -d 127.0.0.53 -p "$protocol" --dport 53 -j RETURN 2>/dev/null || iptables -A MASHHAD_FLOW_CUSTOMER -d 127.0.0.53 -p "$protocol" --dport 53 -j RETURN
done
iptables -C MASHHAD_FLOW_CUSTOMER -d 127.0.0.0/8 -j REJECT 2>/dev/null || iptables -A MASHHAD_FLOW_CUSTOMER -d 127.0.0.0/8 -j REJECT
ip6tables -N MASHHAD_FLOW_CUSTOMER 2>/dev/null || ip6tables -S MASHHAD_FLOW_CUSTOMER >/dev/null
ip6tables -C MASHHAD_FLOW_CUSTOMER -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN 2>/dev/null || ip6tables -A MASHHAD_FLOW_CUSTOMER -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
ip6tables -C MASHHAD_FLOW_CUSTOMER -d ::1 -j REJECT 2>/dev/null || ip6tables -A MASHHAD_FLOW_CUSTOMER -d ::1 -j REJECT
for n in $(seq 0 7); do
 uid=$(id -u "mashhad-f$n")
 iptables -C OUTPUT -m owner --uid-owner "$uid" -j MASHHAD_FLOW_CUSTOMER 2>/dev/null || iptables -I OUTPUT 1 -m owner --uid-owner "$uid" -j MASHHAD_FLOW_CUSTOMER
 ip6tables -C OUTPUT -m owner --uid-owner "$uid" -j MASHHAD_FLOW_CUSTOMER 2>/dev/null || ip6tables -I OUTPUT 1 -m owner --uid-owner "$uid" -j MASHHAD_FLOW_CUSTOMER
done
